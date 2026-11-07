import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestBudgetMode } from '../src/lib/localeSuggestion';

test('Vietnam and Japan suggest a monthly start day, the United States suggests paycheck periods', () => {
  assert.equal(suggestBudgetMode('vi-VN', 'UTC'), 'monthly_from_day');
  assert.equal(suggestBudgetMode('ja-JP', 'UTC'), 'monthly_from_day');
  assert.equal(suggestBudgetMode('en-US', 'Asia/Tokyo'), 'paycheck');
  assert.equal(suggestBudgetMode('vi', undefined), 'monthly_from_day');
});

test('other regions and unusable input suggest nothing', () => {
  assert.equal(suggestBudgetMode('en-GB', 'Europe/London'), null);
  assert.equal(suggestBudgetMode('de-DE', 'Asia/Tokyo'), null, 'the locale region wins over the time zone');
  assert.equal(suggestBudgetMode('', 'Europe/London'), null);
  assert.equal(suggestBudgetMode('not a locale!!', 'UTC'), null);
  assert.equal(suggestBudgetMode(undefined, undefined), null);
});

test('the time zone is used when the locale has no usable region', () => {
  assert.equal(suggestBudgetMode('', 'Asia/Ho_Chi_Minh'), 'monthly_from_day');
  assert.equal(suggestBudgetMode(undefined, 'Asia/Saigon'), 'monthly_from_day');
  assert.equal(suggestBudgetMode('???', 'Asia/Tokyo'), 'monthly_from_day');
  for (const zone of ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu']) {
    assert.equal(suggestBudgetMode('', zone), 'paycheck', zone);
  }
  assert.equal(suggestBudgetMode('', 'Europe/Paris'), null);
});
