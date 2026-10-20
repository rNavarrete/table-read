import { describe, expect, it } from 'vitest'
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_WINDOWS,
  STRUCTURE_PICKS,
} from './stages'

describe('structure stages', () => {
  it('offers Turning Points as the fourth AI lens, in Hauge order', () => {
    expect(STRUCTURE_PICKS.map((p) => p.value)).toEqual([
      'tv_act_structure',
      'heros_journey',
      'story_circle',
      'save_the_cat',
      'turning_points',
    ])
    expect(STAGE_ORDER.turning_points.map((id) => STAGE_LABELS[id])).toEqual([
      'Opportunity',
      'Change of plans',
      'Point of no return',
      'Major setback',
      'Climax',
    ])
  })

  it('pins the windows mirrored from structure_stages.py', () => {
    expect(STAGE_WINDOWS).toEqual({
      turning_points: {
        tp_opportunity: [11, 7],
        tp_change_of_plans: [32, 11],
        tp_point_of_no_return: [51, 12],
        tp_major_setback: [74, 8],
        tp_climax: [89, 5],
      },
      save_the_cat: {
        catalyst: [10.9, 8],
        break_into_two: [22.7, 8],
        midpoint: [50, 8],
        all_is_lost: [68.2, 8],
        break_into_three: [77.3, 8],
      },
    })
  })
})
