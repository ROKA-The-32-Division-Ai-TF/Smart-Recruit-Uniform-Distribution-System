import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { REC_CONFIG, adjustRecConfigFromRecords, buildProfile, recommendForItem, validateProfileInput } from "../docs/src/recommender.js";

const config = JSON.parse(await readFile(new URL("../docs/data/distribution-config.json", import.meta.url), "utf-8"));
const itemMap = Object.fromEntries(config.items.map((item) => [item.itemId, item]));

const validErrors = validateProfileInput({ recruitNo: "101", height: 176, weight: 72 }, [itemMap.combat_shoes, itemMap.beret]);
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
assert.equal(shoes.recommendedSize, "");
assert.equal(shoes.inputMode, "direct");

const inner = recommendForItem(itemMap.field_inner, profile);
assert.match(inner.recommendedSize, /^\d+-\d+$/);

const shirt = recommendForItem(itemMap.combat_shirt, profile);
assert.match(shirt.recommendedSize, /^\d+$/);

const cap = recommendForItem(itemMap.combat_cap, profile);
assert.equal(cap.recommendedSize, "");

const beret = recommendForItem(itemMap.beret, profile);
assert.equal(beret.recommendedSize, "");

const adjusted = adjustRecConfigFromRecords([{ recruit_no: "101", height_cm: 176, weight_kg: 72 }], REC_CONFIG);
assert.equal(adjusted.adjustedFromPeople, 1);
assert.ok(adjusted.curve.a >= 23.9 && adjusted.curve.a <= 24);

console.log("recommender tests passed");
