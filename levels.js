// Builds the conversations (adds word sounds from the glossary) and the four levels.
function buildScenarios(raw) {
  return raw.map((s) => ({
    id: s.id, emoji: s.emoji, title: s.title, who: s.who, whoRu: s.whoRu, youLabel: s.youLabel, intro: s.intro,
    keys: s.keys.map((k) => { const w = lineWords(k)[0] || { w: k, tr: '', en: '' }; return [k, w.tr, w.en]; }),
    // line = [who, Russian, how it sounds, English]
    lines: s.lines.map(([who, ru, en]) => [who, ru, lineSound(ru), en]),
  }));
}
const SCENARIOS = buildScenarios(RAW_BEGINNER);
const SCENARIOS_MID = buildScenarios(RAW_MID);
const SCENARIOS_PRO = buildScenarios(RAW_PRO);
const SCENARIOS_FAMILY = buildScenarios(RAW_FAMILY);

const LEVELS = [
  { id: "beginner", name: "Beginner", emoji: "🌱", sub: "Alphabet, greetings and everyday words", days: DAYS, scenarios: SCENARIOS },
  { id: "mid", name: "Mid", emoji: "🔧", sub: "Daily life, work and engineering basics", days: DAYS_MID, scenarios: SCENARIOS_MID },
  { id: "pro", name: "Professional", emoji: "⚡", sub: "Electrical and power engineering Russian", days: DAYS_PRO, scenarios: SCENARIOS_PRO },
  { id: "daily", name: "Daily Talk", emoji: "🏡", sub: "Everyday talk with your family", days: DAYS_FAMILY, scenarios: SCENARIOS_FAMILY },
];
