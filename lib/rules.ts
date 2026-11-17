/**
 * Scoring rules by version. Each day remembers the rules it was logged with (`DayLog.v`), so a major
 * update never changes the score of a day that was already logged. Features a day didn't have show
 * as "not available yet" instead of counting as zero.
 */
export const RULES = 2;

export interface Update { v: number; date: string; title: string; changes: string[]; scoring: string[] }

/** Shown in the app ("What's new") and written to the Updates tab of the sheet. Newest first. */
export const UPDATES: Update[] = [
  {
    v: 2,
    date: "2026-11-18",
    title: "Khushūʿ, tathbīt, workout and self-control",
    changes: [
      "Salah: one prayer at a time, with a step-by-step popup (when you joined, why, khushūʿ).",
      "Khushūʿ after each prayer: focus, what took your mind away, why, how fast you came back.",
      "Late to the mosque: how many rakʿahs you missed.",
      "New reasons: Call of nature, Ill / stomach ache.",
      "Qurʾān: tathbīt (re-memorising one Baqarah page a day, 10× memorised + 10× read).",
      "Health: the walk card now includes a home workout.",
      "Self-control: private streak, urge help and milestones up to Ramadan.",
      "Calmer screen: every card folds and opens with a tap.",
    ],
    scoring: [
      "Late: right after the takbīr 6 · missed less than half 4 · exactly half 2 · more than half 0.",
      "Call of nature: late 6 · prayed at home 4.",
      "Health 10 = steps 5 (8,000) + workout 5. Before this update, steps alone were 10.",
      "Tathbīt counts as a ✦ bonus (up to +5); khushūʿ and self-control are not scored.",
      "Days logged before 18 Nov 2026 keep their old scores.",
    ],
  },
  {
    v: 1,
    date: "2026-11-05",
    title: "First version",
    changes: ["Salah 40 · Qurʾān 30 · Work/Productivity 20 · Walk 10."],
    scoring: ["Late to the mosque 4, before the takbīr 8.", "Walk: 8,000 steps = 10."],
  },
];

export const latePoints = (l?: { m: number; of: number }) => {
  if (!l) return 4;
  if (l.m <= 0) return 6;
  if (l.m * 2 > l.of) return 0;
  if (l.m * 2 === l.of) return 2;
  return 4;
};
