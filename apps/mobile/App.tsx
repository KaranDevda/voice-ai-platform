import { StatusBar } from "expo-status-bar";
import * as Device from "expo-device";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createApi, NetworkError, RequestError, SyncQueue, UnpairedError, type LeadOption, type Pairing } from "../../packages/mobile-core/src";
import { askPermission, collectNewCalls, getWorkSim, hasPermission, setWorkSim, simsSeen, type SimChoice } from "./src/androidCalls";
import { startBackgroundSync, stopBackgroundSync } from "./src/background";
import { clearPairing, fingerprint, loadPairing, savePairing, store } from "./src/session";

const BLUE = "#1d4ed8", INK = "#0f172a", MUTED = "#64748b", LINE = "#e2e8f0";
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL ?? "https://";
const queue = new SyncQueue(store);

function Button({ title, onPress, kind = "primary", disabled }: { title: string; onPress: () => void; kind?: "primary" | "plain"; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[s.btn, kind === "plain" && s.btnPlain, disabled && { opacity: 0.45 }]}>
      <Text style={[s.btnText, kind === "plain" && { color: BLUE }]}>{title}</Text>
    </Pressable>
  );
}

function PairScreen({ onPaired }: { onPaired: (p: Pairing) => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function link() {
    setBusy(true); setError("");
    try {
      const baseUrl = server.trim().replace(/\/+$/, "");
      const r = await createApi({ baseUrl }).register({
        code, fingerprint: await fingerprint(), platform: Platform.OS === "ios" ? "ios" : "android",
        name: Device.modelName ?? undefined, appVersion: "0.1.0",
      });
      const p: Pairing = { baseUrl, token: r.token, deviceId: r.deviceId, email: r.email };
      await savePairing(p);
      onPaired(p);
    } catch (e) {
      setError(e instanceof RequestError ? (e.code === "invalid_code" ? "That code is wrong or has expired. Make a new one on the website." : e.code === "too_many_attempts" ? "Too many tries. Wait a few minutes." : e.message)
        : e instanceof NetworkError ? "Could not reach the server. Check the address and your connection." : "Could not link this phone.");
    } finally { setBusy(false); }
  }
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.h1}>Link this phone</Text>
      <Text style={s.muted}>On the website open Team &amp; devices, press Add a phone, and type the code shown there.</Text>
      <Text style={s.label}>Server address</Text>
      <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://voice.example.com" />
      <Text style={s.label}>Code</Text>
      <TextInput style={[s.input, s.code]} value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} placeholder="ABCD-2345" maxLength={9} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Button title={busy ? "Linking…" : "Link this phone"} onPress={link} disabled={busy || code.replace(/\W/g, "").length < 8 || server.length < 9} />
    </ScrollView>
  );
}

function Home({ pairing, onUnpaired }: { pairing: Pairing; onUnpaired: () => void }) {
  const api = useMemo(() => createApi({ baseUrl: pairing.baseUrl, token: pairing.token }), [pairing]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [sims, setSims] = useState<SimChoice[]>([]);
  const [workSim, setWork] = useState<string | null>(null);
  const [allowedLog, setAllowedLog] = useState(false);
  const [window_, setWindow] = useState("");
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [number, setNumber] = useState("");
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (Platform.OS === "android") await collectNewCalls(queue);
      const r = await queue.flush(api);
      setPending((await queue.pending()).length);
      if (r.state === "unpaired") { await stopBackgroundSync(); await clearPairing(); return onUnpaired(); }
      if (r.state === "done") { setLastSync(new Date().toLocaleTimeString()); setStatus(r.sent ? `Uploaded ${r.sent} call${r.sent === 1 ? "" : "s"}.` : "Everything is up to date."); }
      else setStatus(`Offline. ${r.kept} call${r.kept === 1 ? "" : "s"} saved on this phone; trying again in ${r.nextTryInS ?? 5} s.`);
    } catch { setStatus("Something went wrong while syncing. It will try again."); }
    finally { busy.current = false; }
  }, [api, onUnpaired]);

  useEffect(() => {
    void (async () => {
      setWork(await getWorkSim());
      setAllowedLog(await hasPermission());
      try { const m = await api.me(); setWindow(`${m.calling.windowStart} to ${m.calling.windowEnd} India time`); setLeads(await api.leads()); }
      catch (e) { if (e instanceof UnpairedError) { await clearPairing(); onUnpaired(); } }
      await startBackgroundSync();
      await sync();
    })();
    const timer = setInterval(sync, 60_000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void sync(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [api, onUnpaired, sync]);

  async function chooseSim() {
    if (!(await askPermission())) { setAllowedLog(false); return setStatus("Call history permission is needed to sync work calls."); }
    setAllowedLog(true);
    const found = await simsSeen();
    setSims(found);
    if (!found.length) setStatus("No calls found in the last 7 days to tell the SIMs apart. Make a call from the work SIM, then try again.");
  }

  async function checkAndCall() {
    setChecking(true); setVerdict(null);
    try {
      const lead = leads.find((l) => l.phone.replace(/\D/g, "").endsWith(number.replace(/\D/g, "")) && number.replace(/\D/g, "").length >= 10);
      const r = await api.check(lead ? { leadId: lead.id } : { number });
      if (!r.allowed) return setVerdict({ ok: false, text: r.message });
      setVerdict({ ok: true, text: "Cleared to call." });
      setLogging(number);
      await Linking.openURL(`tel:${number.replace(/[^\d+]/g, "")}`);
    } catch (e) {
      if (e instanceof UnpairedError) { await clearPairing(); return onUnpaired(); }
      setVerdict({ ok: false, text: e instanceof NetworkError ? "No connection, so the rules could not be checked. Do not call yet." : "Could not check this number." });
    } finally { setChecking(false); }
  }

  /** iPhones cannot read their own call history, so a call made from here is logged by the person afterwards. */
  async function logManually(outcome: "connected" | "missed" | "failed") {
    const now = new Date();
    await queue.add([{ localId: `manual-${now.getTime()}`, number: logging!, direction: "outbound", status: outcome, startedAt: now.toISOString(), durationS: 0 }]);
    setLogging(null); setNumber(""); setVerdict(null);
    await sync();
  }

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.h1}>Bizfy Voice AI</Text>
      <Text style={s.muted}>Linked as {pairing.email}{window_ ? `. Calling hours ${window_}.` : "."}</Text>

      <View style={s.card}>
        <Text style={s.h2}>Sync</Text>
        <Text>{pending} call{pending === 1 ? "" : "s"} waiting to upload{lastSync ? `. Last sync ${lastSync}.` : "."}</Text>
        {status ? <Text style={s.muted}>{status}</Text> : null}
        <Button title="Sync now" onPress={sync} kind="plain" />
      </View>

      {Platform.OS === "android" ? (
        <View style={s.card}>
          <Text style={s.h2}>Work SIM</Text>
          <Text style={s.muted}>Only calls on the work SIM are uploaded. Calls on your personal SIM never leave this phone.</Text>
          <Text>{workSim ? "A work SIM is chosen." : "No work SIM chosen yet, so nothing is uploaded."}{allowedLog ? "" : " Call history permission is off."}</Text>
          {sims.map((m) => <Button key={m.id} title={`Use ${m.label} for work${workSim === m.id ? " (chosen)" : ""}`} kind="plain" onPress={async () => { await setWorkSim(m.id); setWork(m.id); setSims([]); await sync(); }} />)}
          <Button title={workSim ? "Change work SIM" : "Choose work SIM"} onPress={chooseSim} kind="plain" />
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.h2}>On iPhone</Text>
          <Text style={s.muted}>Apple does not let apps read call history, so calls are not synced automatically. Check a number below, call it, then log how it went.</Text>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.h2}>Check a number, then call</Text>
        <TextInput style={s.input} value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder="+91 98765 43210" />
        <Button title={checking ? "Checking…" : "Check and call"} onPress={checkAndCall} disabled={checking || number.replace(/\D/g, "").length < 6} />
        {verdict ? <Text style={verdict.ok ? s.ok : s.error}>{verdict.text}</Text> : null}
        {logging ? (
          <View style={{ gap: 8 }}>
            <Text style={s.muted}>{Platform.OS === "ios" ? "When the call ends, tell us how it went:" : "This call will sync automatically. You can also log it now:"}</Text>
            <Button title="We spoke" kind="plain" onPress={() => logManually("connected")} />
            <Button title="No answer" kind="plain" onPress={() => logManually("missed")} />
            <Button title="Could not connect" kind="plain" onPress={() => logManually("failed")} />
          </View>
        ) : null}
      </View>

      <Button title="Unlink this phone" kind="plain" onPress={async () => { await stopBackgroundSync(); await clearPairing(); onUnpaired(); }} />
    </ScrollView>
  );
}

export default function App() {
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  useEffect(() => { void loadPairing().then(setPairing); }, []);
  const onUnpaired = useCallback(() => setPairing(null), []);
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="dark" />
      {pairing === undefined ? <ActivityIndicator style={{ marginTop: 80 }} color={BLUE} /> : pairing ? <Home pairing={pairing} onUnpaired={onUnpaired} /> : <PairScreen onPaired={setPairing} />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  pad: { padding: 20, gap: 14, paddingBottom: 48 },
  h1: { fontSize: 26, fontWeight: "700", color: INK },
  h2: { fontSize: 17, fontWeight: "600", color: INK },
  muted: { color: MUTED, fontSize: 14, lineHeight: 20 },
  label: { fontWeight: "600", color: INK, marginTop: 6 },
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: LINE, padding: 16, gap: 10 },
  input: { borderWidth: 1, borderColor: LINE, borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: "#fff" },
  code: { fontSize: 24, letterSpacing: 4, textAlign: "center" },
  btn: { backgroundColor: BLUE, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnPlain: { backgroundColor: "#eff6ff" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  error: { color: "#b91c1c" },
  ok: { color: "#15803d" },
});
