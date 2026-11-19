import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  position,
  sharedRange,
  clampShared,
  scrollShared,
  shiftedOffset,
  rescaled,
  syncedOffset,
  wheelPixels,
  zoomFloor,
  effectiveZoom,
  nextZoom,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../js/scroll.js';

const col = (offset, max) => ({ offset, max });
const wheel = (overrides) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  shiftKey: false,
  ...overrides,
});

test('열의 위치는 공통 위치 + offset이고 끝에서 멈춘다', () => {
  assert.equal(position(100, col(50, 1000)), 150);
  assert.equal(position(-500, col(0, 1000)), 0);
  assert.equal(position(5000, col(0, 1000)), 1000);
});

test('스크롤할 수 없는 열은 범위 계산에서 빠진다', () => {
  assert.equal(sharedRange([col(0, 0)]), null);
  assert.deepEqual(sharedRange([col(300, 1000), col(0, 0)]), { lo: -300, hi: 700 });
  assert.deepEqual(sharedRange([col(300, 1000), col(0, 2000)]), { lo: -300, hi: 2000 });
});

test('범위가 없으면 공통 위치는 그대로다', () => {
  assert.equal(clampShared(123, [col(0, 0)]), 123);
});

test('끝에 닿았다 돌아와도 맞춰 둔 정렬이 유지된다', () => {
  const columns = [col(300, 10000), col(0, 10000)];
  let shared = 100;
  assert.deepEqual(
    columns.map((column) => position(shared, column)),
    [400, 100],
  );

  shared = scrollShared(shared, -1000, columns);
  assert.equal(shared, -300);
  assert.deepEqual(
    columns.map((column) => position(shared, column)),
    [0, 0],
  );

  shared = scrollShared(shared, 400, columns);
  assert.deepEqual(
    columns.map((column) => position(shared, column)),
    [400, 100],
  );
});

test('모든 열이 끝에 닿은 뒤에는 공통 위치가 더 움직이지 않는다', () => {
  const columns = [col(0, 1000), col(0, 1000)];
  assert.equal(scrollShared(900, 5000, columns), 1000);
  assert.equal(scrollShared(100, -5000, columns), 0);
});

test('Shift 스크롤은 지금 보이는 위치에서 출발한다', () => {
  assert.equal(shiftedOffset(100, col(50, 1000), 30), 80);
  // 화면 밖으로 밀려 있던 열(보이는 위치는 0)도 보이는 위치 0에서 출발한다
  assert.equal(shiftedOffset(100, col(-500, 1000), 20), -80);
  assert.equal(shiftedOffset(0, col(0, 1000), 5000), 1000);
});

test('열 너비가 바뀌면 위치를 같은 비율로 바꾸고 기준 지점은 제자리에 둔다', () => {
  assert.deepEqual(rescaled(100, [10, -20], 2), { shared: 200, offsets: [20, -40] });
  // 확대(2배) 때 열 위쪽 200px 지점의 그림이 제자리에 있으려면 공통 위치가 200만큼 더 필요하다
  assert.equal(rescaled(100, [0], 2, 200).shared, 400);
});

test('스크롤바로 움직이면 새 offset을 돌려주고 오차 범위는 무시한다', () => {
  const column = col(0, 1000);
  assert.equal(syncedOffset(100, column, 101), null);
  assert.equal(syncedOffset(100, column, 400), 300);
});

test('휠 이동량: 마우스 휠 한 칸은 줄이고 트랙패드는 그대로 둔다', () => {
  assert.equal(wheelPixels(wheel({ deltaY: 100 }), 800), 50);
  assert.equal(wheelPixels(wheel({ deltaY: 4 }), 800), 4);
  assert.equal(wheelPixels(wheel({ deltaY: -100 }), 800), -50);
});

test('Shift를 누르면 deltaX로 온 값도 읽는다', () => {
  assert.equal(wheelPixels(wheel({ deltaX: 100, shiftKey: true }), 800), 50);
});

test('휠이 줄·쪽 단위로 와도 픽셀로 바꾼다', () => {
  assert.equal(wheelPixels(wheel({ deltaY: 3, deltaMode: 1 }), 800), 48);
  assert.equal(wheelPixels(wheel({ deltaY: 1, deltaMode: 2 }), 800), 400);
});

test('확대 최소 비율은 열 최소 너비와 25% 중 큰 쪽이다', () => {
  assert.equal(zoomFloor(1920, 3, 320), 0.5);
  assert.equal(zoomFloor(1920, 1, 320), MIN_ZOOM);
  assert.equal(effectiveZoom(0.3, 0.5), 0.5);
  assert.equal(effectiveZoom(1, 0.5), 1);
});

test('Ctrl+휠: 위로 굴리면 커지고 한계를 넘지 않는다', () => {
  assert.ok(nextZoom(1, { deltaY: -100, deltaMode: 0 }, 0.5) > 1);
  assert.ok(nextZoom(1, { deltaY: 100, deltaMode: 0 }, 0.5) < 1);
  assert.equal(nextZoom(1, { deltaY: 100000, deltaMode: 0 }, 0.5), 0.5);
  assert.equal(nextZoom(1, { deltaY: -100000, deltaMode: 0 }, 0.5), MAX_ZOOM);
});
