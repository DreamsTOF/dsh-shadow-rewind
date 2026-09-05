//#region src/char-highlight.ts
/** 超过此长度的单行放弃字符高亮（防超长压缩行的 Myers 开销）。 */
const CHAR_HIGHLIGHT_MAX_CHARS = 2e3;
/** 行级（此处用于字符数组）Myers 最短编辑脚本。 */
function myersDiff(aList, bList) {
	const N = aList.length;
	const M = bList.length;
	const max = N + M;
	let prev = { 1: 0 };
	const trace = [];
	let dMax = 0;
	let found = false;
	for (let d = 0; d <= max; d++) {
		trace.push({ ...prev });
		const cur = {};
		for (let k = -d; k <= d; k += 2) {
			let x;
			if (k === -d || k !== d && (prev[k - 1] ?? Number.NEGATIVE_INFINITY) < (prev[k + 1] ?? Number.NEGATIVE_INFINITY)) x = prev[k + 1] ?? 0;
			else x = (prev[k - 1] ?? -1) + 1;
			let y = x - k;
			while (x < N && y < M && aList[x] === bList[y]) {
				x++;
				y++;
			}
			cur[k] = x;
			if (x >= N && y >= M) {
				dMax = d;
				found = true;
				break;
			}
		}
		prev = cur;
		if (found) break;
	}
	if (!found) {
		const ops = [];
		for (let i = 0; i < N; i++) ops.push({
			type: "del",
			a: i,
			b: -1
		});
		for (let j = 0; j < M; j++) ops.push({
			type: "add",
			a: -1,
			b: j
		});
		return ops;
	}
	const ops = [];
	let x = N;
	let y = M;
	for (let d = dMax; d > 0; d--) {
		const t = trace[d];
		const k = x - y;
		let prevK;
		if (k === -d || k !== d && (t[k - 1] ?? Number.NEGATIVE_INFINITY) < (t[k + 1] ?? Number.NEGATIVE_INFINITY)) prevK = k + 1;
		else prevK = k - 1;
		const prevX = t[prevK] ?? 0;
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			ops.push({
				type: "same",
				a: x - 1,
				b: y - 1
			});
			x--;
			y--;
		}
		if (x === prevX) {
			ops.push({
				type: "add",
				a: -1,
				b: y - 1
			});
			y--;
		} else {
			ops.push({
				type: "del",
				a: x - 1,
				b: -1
			});
			x--;
		}
	}
	while (x > 0 && y > 0) {
		ops.push({
			type: "same",
			a: x - 1,
			b: y - 1
		});
		x--;
		y--;
	}
	ops.reverse();
	return ops;
}
/** 把字符级 op 的 del/add 下标汇总为连续区间 [start, end)。 */
function charRanges(ops) {
	const delIdx = [];
	const addIdx = [];
	for (const op of ops) if (op.type === "del") delIdx.push(op.a);
	else if (op.type === "add") addIdx.push(op.b);
	const mk = (indexes) => {
		if (indexes.length === 0) return [];
		indexes.sort((a, b) => a - b);
		const out = [];
		let start = indexes[0];
		let end = indexes[0];
		for (let i = 1; i < indexes.length; i++) if (indexes[i] === end + 1) end = indexes[i];
		else {
			out.push([start, end + 1]);
			start = indexes[i];
			end = indexes[i];
		}
		out.push([start, end + 1]);
		return out;
	};
	return {
		del: mk(delIdx),
		add: mk(addIdx)
	};
}
/**
* 单行替换对的字符级高亮区间：oldStr/newStr 按字符做 Myers，
* 真正变化的字符段以 [start, end) 区间返回。
* 任一侧超长、或任一侧为空串时降级：空串侧全区间、超长侧放弃（空区间）。
*/
function lineHighlight(oldStr, newStr) {
	if (oldStr === "" && newStr === "") return {
		del: [],
		add: []
	};
	if (oldStr === "") return {
		del: [],
		add: [[0, newStr.length]]
	};
	if (newStr === "") return {
		del: [[0, oldStr.length]],
		add: []
	};
	if (oldStr.length > 2e3 || newStr.length > 2e3) return {
		del: [],
		add: []
	};
	return charRanges(myersDiff([...oldStr], [...newStr]));
}
//#endregion
export { CHAR_HIGHLIGHT_MAX_CHARS, lineHighlight };
