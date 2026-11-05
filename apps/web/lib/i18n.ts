/**
 * The interface language: a cookie chooses it, and the menu and shell are shown in it. A text with no translation shows in English.
 * To add a language, add its code to LANGUAGES and a column to each row below (order: es, fr, ar, zh, hi, pt, ru, ja, de).
 * Page bodies are still English: only the menu and the shell are translated so far.
 */
export const LANGUAGES = [
  { code: "en", name: "English" }, { code: "es", name: "Español" }, { code: "fr", name: "Français" }, { code: "ar", name: "العربية" }, { code: "zh", name: "中文" },
  { code: "hi", name: "हिन्दी" }, { code: "pt", name: "Português" }, { code: "ru", name: "Русский" }, { code: "ja", name: "日本語" }, { code: "de", name: "Deutsch" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];
export const LANG_COOKIE = "lang";
export const RTL: readonly Lang[] = ["ar"];
export const asLang = (v: string | undefined): Lang => (LANGUAGES.some((l) => l.code === v) ? (v as Lang) : "en");

const ORDER: Lang[] = ["es", "fr", "ar", "zh", "hi", "pt", "ru", "ja", "de"];
const ROWS: Record<string, string[]> = {
  "Studio": ["Estudio", "Studio", "الاستوديو", "工作室", "स्टूडियो", "Estúdio", "Студия", "スタジオ", "Studio"],
  "Operations": ["Operaciones", "Opérations", "العمليات", "运营", "संचालन", "Operações", "Операции", "オペレーション", "Betrieb"],
  "Admin": ["Administración", "Administration", "الإدارة", "管理", "एडमिन", "Administração", "Администрирование", "管理", "Verwaltung"],
  "Launchpad": ["Inicio", "Accueil", "البداية", "启动台", "लॉन्चपैड", "Início", "Старт", "ランチパッド", "Startseite"],
  "Voice clone": ["Clonar voz", "Clonage de voix", "استنساخ الصوت", "声音克隆", "वॉइस क्लोन", "Clonar voz", "Клон голоса", "ボイスクローン", "Stimmklon"],
  "Transcribe": ["Transcribir", "Transcrire", "تفريغ صوتي", "转写", "ट्रांसक्राइब", "Transcrever", "Расшифровка", "文字起こし", "Transkribieren"],
  "Live conversation": ["Conversación en vivo", "Conversation en direct", "محادثة مباشرة", "实时对话", "लाइव बातचीत", "Conversa ao vivo", "Живой разговор", "ライブ会話", "Live-Gespräch"],
  "Agent console": ["Consola del agente", "Console agent", "وحدة الوكيل", "坐席控制台", "एजेंट कंसोल", "Console do agente", "Консоль агента", "エージェントコンソール", "Agentenkonsole"],
  "Voice library": ["Biblioteca de voces", "Bibliothèque de voix", "مكتبة الأصوات", "声音库", "वॉइस लाइब्रेरी", "Biblioteca de vozes", "Библиотека голосов", "ボイスライブラリ", "Stimmenbibliothek"],
  "Projects": ["Proyectos", "Projets", "المشاريع", "项目", "प्रोजेक्ट", "Projetos", "Проекты", "プロジェクト", "Projekte"],
  "Dashboard": ["Panel", "Tableau de bord", "لوحة القيادة", "仪表盘", "डैशबोर्ड", "Painel", "Панель", "ダッシュボード", "Übersicht"],
  "Leads": ["Contactos", "Prospects", "العملاء المحتملون", "线索", "लीड्स", "Leads", "Лиды", "リード", "Leads"],
  "Call logs": ["Registro de llamadas", "Journal d'appels", "سجل المكالمات", "通话记录", "कॉल लॉग", "Registro de chamadas", "Журнал звонков", "通話履歴", "Anrufprotokoll"],
  "Campaigns": ["Campañas", "Campagnes", "الحملات", "活动", "कैंपेन", "Campanhas", "Кампании", "キャンペーン", "Kampagnen"],
  "SMS": ["SMS", "SMS", "الرسائل النصية", "短信", "एसएमएस", "SMS", "СМС", "SMS", "SMS"],
  "Follow-up sequences": ["Secuencias de seguimiento", "Séquences de relance", "تسلسلات المتابعة", "跟进序列", "फॉलो-अप सीक्वेंस", "Sequências de acompanhamento", "Цепочки follow-up", "フォローアップシーケンス", "Follow-up-Sequenzen"],
  "Web dialer": ["Marcador web", "Numéroteur web", "الطالب عبر الويب", "网页拨号器", "वेब डायलर", "Discador web", "Веб-звонилка", "Webダイヤラー", "Web-Wähler"],
  "Agent reports": ["Informes de agentes", "Rapports des agents", "تقارير الوكلاء", "坐席报表", "एजेंट रिपोर्ट", "Relatórios de agentes", "Отчёты агентов", "エージェントレポート", "Agentenberichte"],
  "Voices & consent": ["Voces y consentimiento", "Voix et consentement", "الأصوات والموافقة", "声音与授权", "आवाज़ें और सहमति", "Vozes e consentimento", "Голоса и согласие", "音声と同意", "Stimmen & Einwilligung"],
  "Knowledge base": ["Base de conocimiento", "Base de connaissances", "قاعدة المعرفة", "知识库", "नॉलेज बेस", "Base de conhecimento", "База знаний", "ナレッジベース", "Wissensdatenbank"],
  "Team & devices": ["Equipo y dispositivos", "Équipe et appareils", "الفريق والأجهزة", "团队与设备", "टीम और डिवाइस", "Equipe e dispositivos", "Команда и устройства", "チームとデバイス", "Team & Geräte"],
  "CRM integrations": ["Integraciones CRM", "Intégrations CRM", "تكاملات CRM", "CRM 集成", "CRM इंटीग्रेशन", "Integrações de CRM", "Интеграции CRM", "CRM連携", "CRM-Integrationen"],
  "KYC": ["KYC", "KYC", "التحقق من الهوية", "实名认证", "केवाईसी", "KYC", "KYC", "本人確認", "KYC"],
  "Phone numbers": ["Números de teléfono", "Numéros de téléphone", "أرقام الهاتف", "电话号码", "फ़ोन नंबर", "Números de telefone", "Номера телефонов", "電話番号", "Rufnummern"],
  "Profit": ["Beneficio", "Bénéfice", "الأرباح", "利润", "मुनाफ़ा", "Lucro", "Прибыль", "利益", "Gewinn"],
  "Platform": ["Plataforma", "Plateforme", "المنصة", "平台", "प्लेटफ़ॉर्म", "Plataforma", "Платформа", "プラットフォーム", "Plattform"],
  "Billing": ["Facturación", "Facturation", "الفواتير", "计费", "बिलिंग", "Faturamento", "Оплата", "請求", "Abrechnung"],
  "Audit log": ["Registro de auditoría", "Journal d'audit", "سجل التدقيق", "审计日志", "ऑडिट लॉग", "Log de auditoria", "Журнал аудита", "監査ログ", "Audit-Protokoll"],
  "Provider logs": ["Registros de proveedores", "Journaux des fournisseurs", "سجلات المزودين", "服务商日志", "प्रोवाइडर लॉग", "Logs de provedores", "Журналы провайдеров", "プロバイダーログ", "Anbieter-Protokolle"],
  "Settings": ["Ajustes", "Paramètres", "الإعدادات", "设置", "सेटिंग्स", "Configurações", "Настройки", "設定", "Einstellungen"],
  "Calls · voices · agents": ["Llamadas · voces · agentes", "Appels · voix · agents", "مكالمات · أصوات · وكلاء", "通话 · 声音 · 坐席", "कॉल · आवाज़ें · एजेंट", "Chamadas · vozes · agentes", "Звонки · голоса · агенты", "通話 · 音声 · エージェント", "Anrufe · Stimmen · Agenten"],
  "My account": ["Mi cuenta", "Mon compte", "حسابي", "我的账户", "मेरा खाता", "Minha conta", "Мой аккаунт", "マイアカウント", "Mein Konto"],
  "Account": ["Cuenta", "Compte", "الحساب", "账户", "खाता", "Conta", "Аккаунт", "アカウント", "Konto"],
  "Credit history": ["Historial de crédito", "Historique des crédits", "سجل الرصيد", "额度记录", "क्रेडिट इतिहास", "Histórico de créditos", "История баланса", "クレジット履歴", "Guthabenverlauf"],
  "KYC verification": ["Verificación KYC", "Vérification KYC", "التحقق من الهوية (KYC)", "实名认证审核", "केवाईसी सत्यापन", "Verificação KYC", "Проверка KYC", "KYC確認", "KYC-Prüfung"],
  "Language": ["Idioma", "Langue", "اللغة", "语言", "भाषा", "Idioma", "Язык", "言語", "Sprache"],
};

/** `text` in the language, or in English when there is no translation. */
/** Every text the interface can translate (the editor lists these). */
export const TRANSLATABLE: readonly string[] = Object.keys(ROWS);
/** The built-in translation of `text`, or "" when there is none. */
export const builtInTranslation = (lang: string, text: string): string => (lang === "en" ? text : ROWS[text]?.[ORDER.indexOf(lang as Lang)] ?? "");

export function tr(lang: string, text: string): string {
  if (lang === "en") return text;
  const row = ROWS[text];
  return row?.[ORDER.indexOf(lang as Lang)] ?? text;
}
