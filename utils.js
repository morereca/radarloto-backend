export function nowIso() {
  return new Date().toISOString();
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function uniqueWeighted(min, max, count, weightFn) {
  const set = new Set();
  while (set.size < count) {
    const pool = [];
    for (let n = min; n <= max; n += 1) {
      if (!set.has(n)) pool.push({ n, w: weightFn(n) });
    }
    const total = pool.reduce((sum, item) => sum + item.w, 0);
    let r = Math.random() * total;
    for (const item of pool) {
      r -= item.w;
      if (r <= 0) {
        set.add(item.n);
        break;
      }
    }
  }
  return Array.from(set);
}

export function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function countConsecutive(nums) {
  let c = 0;
  for (let i = 1; i < nums.length; i += 1) {
    if (nums[i] - nums[i - 1] === 1) c += 1;
  }
  return c;
}

export function maxEndingRepeat(nums) {
  const map = {};
  for (const n of nums) {
    const end = n % 10;
    map[end] = (map[end] || 0) + 1;
  }
  return Math.max(...Object.values(map));
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function level(v) {
  return v >= 75 ? 'Alta' : v >= 50 ? 'Media' : 'Baja';
}

export function parseJsonArray(text) {
  return JSON.parse(text);
}