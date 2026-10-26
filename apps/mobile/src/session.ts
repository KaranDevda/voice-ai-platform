import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { KeyValueStore, Pairing } from "../../../packages/mobile-core/src";

/** Everything except the device token lives in AsyncStorage; the token (the phone's password) lives in the secure keystore. */
export const store: KeyValueStore = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};

const PAIRING = "pairing.v1";

export async function loadPairing(): Promise<Pairing | null> {
  try { return JSON.parse((await SecureStore.getItemAsync(PAIRING)) ?? "null") as Pairing | null; } catch { return null; }
}
export const savePairing = (p: Pairing) => SecureStore.setItemAsync(PAIRING, JSON.stringify(p));
/** Forgets the link. Calls still waiting to upload are kept, so linking again later does not lose them. */
export const clearPairing = () => SecureStore.deleteItemAsync(PAIRING);

/** A random id made once per install; pairing again from the same install updates the same phone on the server. */
export async function fingerprint(): Promise<string> {
  const have = await store.get("fingerprint.v1");
  if (have) return have;
  const fresh = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, "");
  await store.set("fingerprint.v1", fresh);
  return fresh;
}
