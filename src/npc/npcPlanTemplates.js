/**
 * Built-in NPC plan documents.
 */

/** @typedef {import('./npcPlanRunner.js').PlanStep} PlanStep */

/** @type {{ goal: string, plan: PlanStep }} */
export const EAT_FOOD_PLAN = {
  goal: 'eat_food',
  plan: {
      type: 'sel',
      steps: [
          {
              type: 'seq',
              steps: [
                  { type: 'eat', from: 'inventory', object: 'edible_food', pick: 'random' },
              ],
          },
          {
              type: 'seq',
              steps: [
                  { type: 'goto', ref: 'rememberLocationsOfNearby(stove)' },
                  {
                      type: 'sel',
                      steps: [
                          {
                              type: 'seq',
                              steps: [
                                  {
                                      type: 'find',
                                      object: 'edible_food',
                                      radius: 8,
                                      near: 'self',
                                      pickup: true,
                                  },
                                  { type: 'eat', from: 'inventory', object: 'edible_food', pick: 'random' },
                              ],
                          },
                          {
                              type: 'seq',
                              steps: [
                                  {
                                      type: 'find',
                                      object: 'uncooked_food',
                                      radius: 8,
                                      near: 'self',
                                      pickup: true,
                                  },
                                  { type: 'cook', object: 'uncooked_food' },
                                  { type: 'eat', from: 'inventory', object: 'edible_food', pick: 'random' },
                              ],
                          },
                      ],
                  },
              ],
          },
      ],
  },
};
