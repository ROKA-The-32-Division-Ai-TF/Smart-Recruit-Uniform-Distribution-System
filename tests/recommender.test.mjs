import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildProfile, recommendForItem, validateProfileInput } from "../docs/src/recommender.js";

const config = JSON.parse(await readFile(new URL("../docs/data/distribution-config.json", import.meta.url), "utf-8"));
const itemMap = Object.fromEntries(config.items.map((item) => [item.itemId, item]));

const validErrors = validateProfileInput({ recruitNo: "101", height: 176, weight: 72 });
assert.deepEqual(validErrors, []);

const invalidErrors = validateProfileInput({ recruitNo: "", height: 260, weight: 12 });
assert.equal(invalidErrors.length, 3);

const profile = buildProfile({ recruitNo: "101", height: 176, weight: 72 });
assert.equal(profile.recruitNo, "101");
assert.equal(profile.bmi, 23.2);

const top = recommendForItem(itemMap.combat_top, profile);
assert.match(top.recommendedSize, /^\d+-\d+$/);
assert.equal(top.alternatives.length, 3);

const bottom = recommendForItem(itemMap.combat_bottom, profile);
assert.match(bottom.recommendedSize, /^\d+-\d+$/);

const shoes = recommendForItem(itemMap.combat_shoes, profile);
assert.match(shoes.recommendedSize, /^\d+$/);

const inner = recommendForItem(itemMap.field_inner, profile);
assert.match(inner.recommendedSize, /^\d+-\d+$/);

console.log("recommender tests passed");
