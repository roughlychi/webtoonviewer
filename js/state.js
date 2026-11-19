export const MAX_COLUMNS = 3;
export const MIN_COLUMN_WIDTH = 320;

export const state = {
  columns: [{ id: 1, images: [] }],
  zoom: 1,
  theme: 'light',
  nextId: 2,
};

let onChange = () => {};
export const setOnChange = (fn) => {
  onChange = fn;
};

export const findColumn = (id) => state.columns.find((c) => String(c.id) === String(id));

const releaseImages = (column) => column.images.forEach((img) => URL.revokeObjectURL(img.url));

export function setImages(id, images) {
  const column = findColumn(id);
  releaseImages(column);
  column.images = images;
  onChange();
}

export function addColumn() {
  if (state.columns.length >= MAX_COLUMNS) return;
  state.columns.push({ id: state.nextId++, images: [] });
  onChange();
}

export function removeColumn(id) {
  if (state.columns.length === 1) return;
  releaseImages(findColumn(id));
  state.columns = state.columns.filter((c) => String(c.id) !== String(id));
  onChange();
}

// insertAt: 옮기기 전 줄 기준으로 몇 번째 칸 앞에 넣을지
export function moveColumn(id, insertAt) {
  const { columns } = state;
  const from = columns.indexOf(findColumn(id));
  const [column] = columns.splice(from, 1);
  if (insertAt > from) insertAt--;
  columns.splice(insertAt, 0, column);
  if (insertAt !== from) onChange();
}

export function setZoom(value) {
  state.zoom = value;
  onChange();
}

export function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  onChange();
}
