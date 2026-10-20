import type { StructureLens, StructureStageName } from 'contract'

export type StructurePick = StructureLens | 'tv_act_structure'

export const STRUCTURE_PICKS: { value: StructurePick; label: string }[] = [
  { value: 'tv_act_structure', label: 'TV act structure' },
  { value: 'heros_journey', label: "Hero's Journey" },
  { value: 'story_circle', label: 'Story Circle' },
  { value: 'save_the_cat', label: 'Save the Cat' },
  { value: 'turning_points', label: 'Turning Points' },
]

export const STAGE_ORDER: Record<StructureLens, StructureStageName[]> = {
  heros_journey: [
    'ordinary_world',
    'call_to_adventure',
    'refusal',
    'meeting_the_mentor',
    'crossing_the_threshold',
    'tests_allies_enemies',
    'approach',
    'ordeal',
    'reward',
    'road_back',
    'resurrection',
    'return_with_elixir',
  ],
  story_circle: [
    'circle_you',
    'circle_need',
    'circle_go',
    'circle_search',
    'circle_find',
    'circle_take',
    'circle_return',
    'circle_change',
  ],
  save_the_cat: [
    'opening_image',
    'theme_stated',
    'set_up',
    'catalyst',
    'debate',
    'break_into_two',
    'b_story',
    'fun_and_games',
    'midpoint',
    'bad_guys_close_in',
    'all_is_lost',
    'dark_night_of_the_soul',
    'break_into_three',
    'finale',
    'final_image',
  ],
  turning_points: [
    'tp_opportunity',
    'tp_change_of_plans',
    'tp_point_of_no_return',
    'tp_major_setback',
    'tp_climax',
  ],
}

export const STAGE_LABELS: Record<StructureStageName, string> = {
  ordinary_world: 'Ordinary world',
  call_to_adventure: 'Call to adventure',
  refusal: 'Refusal of the call',
  meeting_the_mentor: 'Meeting the mentor',
  crossing_the_threshold: 'Crossing the threshold',
  tests_allies_enemies: 'Tests, allies, enemies',
  approach: 'Approach to the inmost cave',
  ordeal: 'Ordeal',
  reward: 'Reward',
  road_back: 'The road back',
  resurrection: 'Resurrection',
  return_with_elixir: 'Return with the elixir',
  circle_you: 'You (comfort zone)',
  circle_need: 'Need',
  circle_go: 'Go',
  circle_search: 'Search',
  circle_find: 'Find',
  circle_take: 'Take',
  circle_return: 'Return',
  circle_change: 'Change',
  opening_image: 'Opening image',
  theme_stated: 'Theme stated',
  set_up: 'Set-up',
  catalyst: 'Catalyst',
  debate: 'Debate',
  break_into_two: 'Break into two',
  b_story: 'B story',
  fun_and_games: 'Fun and games',
  midpoint: 'Midpoint',
  bad_guys_close_in: 'Bad guys close in',
  all_is_lost: 'All is lost',
  dark_night_of_the_soul: 'Dark night of the soul',
  break_into_three: 'Break into three',
  finale: 'Finale',
  final_image: 'Final image',
  tp_opportunity: 'Opportunity',
  tp_change_of_plans: 'Change of plans',
  tp_point_of_no_return: 'Point of no return',
  tp_major_setback: 'Major setback',
  tp_climax: 'Climax',
}

/** Expected position and tolerance (% of the script text) per placed stage —
 * a mirror of STAGE_WINDOWS in apps/api/drama_manager/structure_stages.py, pinned
 * by tests on both sides. The panel shows the values saved on each stage. */
export const STAGE_WINDOWS: Partial<
  Record<StructureLens, Partial<Record<StructureStageName, [number, number]>>>
> = {
  // TRIPOD's empirical means ± standard deviations.
  turning_points: {
    tp_opportunity: [11, 7],
    tp_change_of_plans: [32, 11],
    tp_point_of_no_return: [51, 12],
    tp_major_setback: [74, 8],
    tp_climax: [89, 5],
  },
  // Snyder's page targets over 110 pages (12, 25, 55, 75, 85) ± 8.
  save_the_cat: {
    catalyst: [10.9, 8],
    break_into_two: [22.7, 8],
    midpoint: [50, 8],
    all_is_lost: [68.2, 8],
    break_into_three: [77.3, 8],
  },
}
