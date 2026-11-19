import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  state,
  MAX_COLUMNS,
  findColumn,
  setImages,
  addColumn,
  removeColumn,
  moveColumn,
  toggleTheme,
  setOnChange,
} from '../js/state.js';

const column = (id) => ({ id, images: [] });
const ids = () => state.columns.map((item) => item.id);
let changes;

beforeEach(() => {
  state.columns = [column(1), column(2), column(3)];
  state.nextId = 4;
  state.theme = 'light';
  changes = 0;
  setOnChange(() => {
    changes++;
  });
});

test('열은 최대 개수를 넘겨서 추가되지 않는다', () => {
  state.columns = [column(1)];
  addColumn();
  addColumn();
  assert.equal(state.columns.length, MAX_COLUMNS);
  const before = changes;
  addColumn();
  assert.equal(state.columns.length, MAX_COLUMNS);
  assert.equal(changes, before);
});

test('새 열의 번호표는 겹치지 않는다', () => {
  state.columns = [column(1)];
  state.nextId = 2;
  addColumn();
  addColumn();
  assert.deepEqual(ids(), [1, 2, 3]);
});

test('마지막 열 하나는 닫을 수 없다', () => {
  state.columns = [column(1)];
  removeColumn(1);
  assert.deepEqual(ids(), [1]);
  assert.equal(changes, 0);
});

test('번호표가 글자로 와도 열을 찾고 닫는다', () => {
  assert.equal(findColumn('2').id, 2);
  removeColumn('2');
  assert.deepEqual(ids(), [1, 3]);
});

test('열을 옮긴다 (insertAt은 옮기기 전 줄 기준)', () => {
  moveColumn(1, 3);
  assert.deepEqual(ids(), [2, 3, 1]);
  moveColumn(1, 0);
  assert.deepEqual(ids(), [1, 2, 3]);
  moveColumn(3, 1);
  assert.deepEqual(ids(), [1, 3, 2]);
});

test('원래 자리로 옮기면 아무 일도 일어나지 않는다', () => {
  moveColumn(2, 1);
  moveColumn(2, 2);
  assert.deepEqual(ids(), [1, 2, 3]);
  assert.equal(changes, 0);
});

test('이미지를 넣으면 이전 이미지 주소를 해제한다', () => {
  const revoked = [];
  const original = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    findColumn(1).images = [{ name: 'a.png', url: 'blob:a' }];
    setImages(1, [{ name: 'b.png', url: 'blob:b' }]);
    assert.deepEqual(revoked, ['blob:a']);
    assert.equal(findColumn(1).images[0].name, 'b.png');
    assert.equal(changes, 1);
  } finally {
    URL.revokeObjectURL = original;
  }
});

test('테마는 밝게에서 시작해 누를 때마다 바뀐다', () => {
  assert.equal(state.theme, 'light');
  toggleTheme();
  assert.equal(state.theme, 'dark');
  toggleTheme();
  assert.equal(state.theme, 'light');
  assert.equal(changes, 2);
});
