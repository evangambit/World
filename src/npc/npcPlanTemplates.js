/**
 * Built-in NPC plan documents.
 */

/** @typedef {import('./npcPlanRunner.js').PlanStep} PlanStep */

/** @type {{ goal: string, bindings: Record<string, { query: string }>, plan: PlanStep }} */
export const EAT_FOOD_PLAN = {
  goal: 'eat_food',
  bindings: {
      my_kitchen: { query: 'whereIsMyKitchen' },
  },
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
                  { type: 'goto', ref: 'my_kitchen' },
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
