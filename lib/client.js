window.__ModuleLoader__.load({
	id: "dsh-shadow-rewind",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_session_surface = require("@deepseek-ai/dsh-session/surface");
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
		var _a$1;
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function cached(getter) {
			return { get value() {
				{
					const value = getter();
					Object.defineProperty(this, "value", { value });
					return value;
				}
			} };
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) {
				const descriptors = Object.getOwnPropertyDescriptors(def);
				Object.assign(mergedDescriptors, descriptors);
			}
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = {
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = {};
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						newShape[key] = currDef.shape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = { ...schema._zod.def.shape };
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						delete newShape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = schema._zod.def.shape;
				for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function merge(a, b) {
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			return clone(a, mergeDefs(a._zod.def, {
				get shape() {
					const _shape = {
						...a._zod.def.shape,
						...b._zod.def.shape
					};
					assignProp(this, "shape", _shape);
					return _shape;
				},
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask) {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const oldShape = schema._zod.def.shape;
					const shape = { ...oldShape };
					if (mask) for (const key in mask) {
						if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						shape[key] = Class ? new Class({
							type: "optional",
							innerType: oldShape[key]
						}) : oldShape[key];
					}
					else for (const key in oldShape) shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
					assignProp(this, "shape", shape);
					return shape;
				},
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = new Class({
						type: "nonoptional",
						innerType: oldShape[key]
					});
				}
				else for (const key in oldShape) shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
				assignProp(this, "shape", shape);
				return shape;
			} }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^[A-Za-z0-9_-]*$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time$1(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime$1(args) {
			const time = timeSource({ precision: args.precision });
			const opts = ["Z"];
			if (args.local) opts.push("");
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const timeRegex = `${time}(?:${opts.join("|")})`;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const string$1 = (params) => {
			const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
			return new RegExp(`^${regex}$`);
		};
		const integer = /^-?\d+$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const boolean$1 = /^(?:true|false)$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
				if (def.value < curr) {
					if (def.inclusive) bag.maximum = def.value;
					else bag.exclusiveMaximum = def.value;
				}
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
				if (def.value > curr) {
					if (def.inclusive) bag.minimum = def.value;
					else bag.exclusiveMinimum = def.value;
				}
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				var _a;
				(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
			});
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				bag.minimum = minimum;
				bag.maximum = maximum;
				if (isInt) bag.pattern = integer;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				if (def.pattern) {
					bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
					bag.patterns.add(def.pattern);
				}
			});
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
			def.pattern = pattern;
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = []) {
				this.content = [];
				this.indent = 0;
				if (this) this.args = args;
			}
			indented(fn) {
				this.indent += 1;
				fn(this);
				this.indent -= 1;
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const args = this?.args;
				const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
				return new F(...args, lines.join("\n"));
			}
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					if (!def.normalize && def.protocol?.source === httpProtocol.source) {
						if (!/^https?:\/\//i.test(trimmed)) {
							payload.issues.push({
								code: "invalid_format",
								format: "url",
								note: "Invalid URL format",
								input: payload.value,
								inst,
								continue: !def.abort
							});
							return;
						}
					}
					const url = new URL(trimmed);
					if (def.hostname) {
						def.hostname.lastIndex = 0;
						if (!def.hostname.test(url.hostname)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid hostname",
							pattern: def.hostname.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.protocol) {
						def.protocol.lastIndex = 0;
						if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid protocol",
							pattern: def.protocol.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.normalize) payload.value = url.href;
					else payload.value = trimmed;
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			def.pattern ?? (def.pattern = nanoid);
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv4`;
		});
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv6`;
			inst._zod.check = (payload) => {
				try {
					new URL(`http://[${payload.value}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "ipv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				const parts = payload.value.split("/");
				try {
					if (parts.length !== 2) throw new Error();
					const [address, prefix] = parts;
					if (!prefix) throw new Error();
					const prefixNum = Number(prefix);
					if (`${prefixNum}` !== prefix) throw new Error();
					if (prefixNum < 0 || prefixNum > 128) throw new Error();
					new URL(`http://[${address}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "cidrv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64";
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64URL(data) {
			if (!base64url.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64url);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64url";
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
			const isPresent = key in input;
			if (result.issues.length) {
				if (isOptionalIn && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && !isOptionalIn) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				keys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const isOptionalIn = _catchall.optin === "optional";
			const isOptionalOut = _catchall.optout === "optional";
			for (const key in input) {
				if (key === "__proto__") continue;
				if (keySet.has(key)) continue;
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
				const sh = def.shape;
				Object.defineProperty(def, "shape", { get: () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					return newSh;
				} });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazy(inst._zod, "propValues", () => {
				const shape = def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
					}
				}
				return propValues;
			});
			const isObject$1 = isObject;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = {};
				const proms = [];
				const shape = value.shape;
				for (const key of value.keys) {
					const el = shape[key];
					const isOptionalIn = el._zod.optin === "optional";
					const isOptionalOut = el._zod.optout === "optional";
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
					else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const generateFastpass = (shape) => {
				const doc = new Doc([
					"shape",
					"payload",
					"ctx"
				]);
				const normalized = _normalized.value;
				const parseStr = (key) => {
					const k = esc(key);
					return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				};
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.keys) ids[key] = `key_${counter++}`;
				doc.write(`const newResult = {};`);
				for (const key of normalized.keys) {
					const id = ids[key];
					const k = esc(key);
					const schema = shape[key];
					const isOptionalIn = schema?._zod?.optin === "optional";
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(key)};`);
					if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
					else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				const fn = doc.compile();
				return (payload, ctx) => fn(shape, payload, ctx);
			};
			let fastpass;
			const isObject$2 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class({
				type: "number",
				checks: [],
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) {
				if (ctx.target === "draft-2020-12") result.$defs = defs;
				else result.definitions = defs;
			}
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
			if (typeof format === "string" && format.includes("int")) json.type = "integer";
			else json.type = "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) {
				if (legacy) {
					json.minimum = exclusiveMinimum;
					json.exclusiveMinimum = true;
				} else json.exclusiveMinimum = exclusiveMinimum;
			} else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) {
				if (legacy) {
					json.maximum = exclusiveMaximum;
					json.exclusiveMaximum = true;
				} else json.exclusiveMaximum = exclusiveMaximum;
			} else if (typeof maximum === "number") json.maximum = maximum;
			if (typeof multipleOf === "number") json.multipleOf = multipleOf;
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function datetime(params) {
			return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
		}
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function date(params) {
			return /* @__PURE__ */ _isoDate(ZodISODate, params);
		}
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function time(params) {
			return /* @__PURE__ */ _isoTime(ZodISOTime, params);
		}
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function duration(params) {
			return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
		}
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
			const bag = inst._zod.bag;
			inst.format = bag.format ?? null;
			inst.minLength = bag.minimum ?? null;
			inst.maxLength = bag.maximum ?? null;
			_installLazyMethods(inst, "_ZodString", {
				regex(...args) {
					return this.check(/* @__PURE__ */ _regex(...args));
				},
				includes(...args) {
					return this.check(/* @__PURE__ */ _includes(...args));
				},
				startsWith(...args) {
					return this.check(/* @__PURE__ */ _startsWith(...args));
				},
				endsWith(...args) {
					return this.check(/* @__PURE__ */ _endsWith(...args));
				},
				min(...args) {
					return this.check(/* @__PURE__ */ _minLength(...args));
				},
				max(...args) {
					return this.check(/* @__PURE__ */ _maxLength(...args));
				},
				length(...args) {
					return this.check(/* @__PURE__ */ _length(...args));
				},
				nonempty(...args) {
					return this.check(/* @__PURE__ */ _minLength(1, ...args));
				},
				lowercase(params) {
					return this.check(/* @__PURE__ */ _lowercase(params));
				},
				uppercase(params) {
					return this.check(/* @__PURE__ */ _uppercase(params));
				},
				trim() {
					return this.check(/* @__PURE__ */ _trim());
				},
				normalize(...args) {
					return this.check(/* @__PURE__ */ _normalize(...args));
				},
				toLowerCase() {
					return this.check(/* @__PURE__ */ _toLowerCase());
				},
				toUpperCase() {
					return this.check(/* @__PURE__ */ _toUpperCase());
				},
				slugify() {
					return this.check(/* @__PURE__ */ _slugify());
				}
			});
		});
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
			inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
			inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
			inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
			inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
			inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
			inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
			inst.datetime = (params) => inst.check(datetime(params));
			inst.date = (params) => inst.check(date(params));
			inst.time = (params) => inst.check(time(params));
			inst.duration = (params) => inst.check(duration(params));
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			_installLazyMethods(inst, "ZodNumber", {
				gt(value, params) {
					return this.check(/* @__PURE__ */ _gt(value, params));
				},
				gte(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				min(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				lt(value, params) {
					return this.check(/* @__PURE__ */ _lt(value, params));
				},
				lte(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				max(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				int(params) {
					return this.check(int(params));
				},
				safe(params) {
					return this.check(int(params));
				},
				positive(params) {
					return this.check(/* @__PURE__ */ _gt(0, params));
				},
				nonnegative(params) {
					return this.check(/* @__PURE__ */ _gte(0, params));
				},
				negative(params) {
					return this.check(/* @__PURE__ */ _lt(0, params));
				},
				nonpositive(params) {
					return this.check(/* @__PURE__ */ _lte(0, params));
				},
				multipleOf(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				step(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				finite() {
					return this;
				}
			});
			const bag = inst._zod.bag;
			inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
			inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
			inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
			inst.isFinite = true;
			inst.format = bag.format ?? null;
		});
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			defineLazy(inst, "shape", () => {
				return def.shape;
			});
			_installLazyMethods(inst, "ZodObject", {
				keyof() {
					return _enum(Object.keys(this._zod.def.shape));
				},
				catchall(catchall) {
					return this.clone({
						...this._zod.def,
						catchall
					});
				},
				passthrough() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				loose() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				strict() {
					return this.clone({
						...this._zod.def,
						catchall: never()
					});
				},
				strip() {
					return this.clone({
						...this._zod.def,
						catchall: void 0
					});
				},
				extend(incoming) {
					return extend(this, incoming);
				},
				safeExtend(incoming) {
					return safeExtend(this, incoming);
				},
				merge(other) {
					return merge(this, other);
				},
				pick(mask) {
					return pick(this, mask);
				},
				omit(mask) {
					return omit(this, mask);
				},
				partial(...args) {
					return partial(ZodOptional, this, args[0]);
				},
				required(...args) {
					return required(ZodNonOptional, this, args[0]);
				}
			});
		});
		function object(shape, params) {
			const def = {
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			};
			return new ZodObject(def);
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = Object.values(def.entries);
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
			return new ZodEnum({
				type: "enum",
				entries,
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region src/file-review/typert-descriptors.ts
		/**
		* 宿主与浏览器两份贡献产物共用的严格 Typert 编解码器与调用描述符。
		*
		* 为什么必须共用同一份：两端的线上词汇表一旦漂移，就会在运行时才炸。这里
		* 用 zod 把请求 / 结果 / 录制载荷全部收紧（`mode: 'strict'`，多余字段直接
		* 拒绝），描述符 + `typeSymbol` 一起导出，宿主 `./typert` 与浏览器
		* `./remote` 两个入口引用同一组常量。
		*
		* 注意：编解码器是**线上契约**，改动等于改协议——新增字段一律可选，避免
		* 旧 bundle 与新宿主互相判对方非法。
		*/
		const PACKAGE_NAME = "dsh-shadow-rewind";
		/** 单个 hunk 的线上形状；起止行为可选（工具结果不保证给出）。 */
		const diffSchema = object({
			path: string(),
			oldText: string().nullable(),
			newText: string(),
			oldStart: number().int().min(1).optional(),
			newStart: number().int().min(1).optional()
		});
		/** 一次开关请求：方向 + 轮内文件清单。 */
		const requestSchema = object({
			action: _enum(["undo", "redo"]),
			files: array(object({
				path: string(),
				diffs: array(diffSchema)
			}))
		});
		/** 结果侧：逐文件状态；`reason` 承载跳过 / 失败的原因文案。 */
		const resultSchema = object({ files: array(object({
			path: string(),
			state: _enum([
				"applied",
				"undone",
				"conflict",
				"unsupported",
				"error"
			]),
			changed: boolean(),
			reason: string().optional()
		})) });
		/** 会话 id 按宿主的类型符号登记，走 lookup 从上下文注入（不经 JSON）。 */
		const agentCodec = {
			mode: "strict",
			typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
			schema: intersection(string(), unknown())
		};
		const requestCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#FileReviewRequest`,
			schema: requestSchema
		};
		const resultCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#FileReviewResult`,
			schema: resultSchema
		};
		/** 一条录制的 Code Mode 变更：根 call-id + 工具名 + 路径 + 前后全文。 */
		const recordedMutationSchema = object({
			rootCallId: string(),
			name: string(),
			path: string(),
			before: string().nullable(),
			after: string()
		});
		const recordedRequestSchema = object({ rootCallIds: array(string()) });
		const recordedResultSchema = object({ mutations: array(recordedMutationSchema) });
		const recordedRequestCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#RecordedRequest`,
			schema: recordedRequestSchema
		};
		const recordedResultCodec = {
			mode: "strict",
			typeSymbol: `${PACKAGE_NAME}#RecordedResult`,
			schema: recordedResultSchema
		};
		/** 组装 status / apply 描述符：两者签名同形，仅方法名不同。 */
		function descriptor(method) {
			return {
				id: `${PACKAGE_NAME}#fileReview/${method}`,
				service: "fileReview",
				namespace: "fileReview",
				method,
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: agentCodec
				}, {
					name: "request",
					wire: "request",
					source: "json",
					codec: requestCodec
				}],
				result: resultCodec
			};
		}
		/** 组装 `recorded` 描述符：与开关调用同作用域，但请求/结果是录制载荷。 */
		function recordedDescriptor() {
			return {
				id: `${PACKAGE_NAME}#fileReview/recorded`,
				service: "fileReview",
				namespace: "fileReview",
				method: "recorded",
				invocation: { kind: "direct" },
				scope: {
					context: "agent",
					wire: "agentId"
				},
				parameters: [{
					name: "agent",
					wire: "agentId",
					source: "lookup",
					lookup: "agent",
					codec: agentCodec
				}, {
					name: "request",
					wire: "request",
					source: "json",
					codec: recordedRequestCodec
				}],
				result: recordedResultCodec
			};
		}
		//#endregion
		//#region src/file-review/remote.ts
		/** 随客户端 bundle 分发的远端贡献声明。 */
		const TYPERT_REMOTE = {
			package: PACKAGE_NAME,
			descriptors: [
				descriptor("status"),
				descriptor("apply"),
				recordedDescriptor()
			]
		};
		//#endregion
		//#region src/client/deleted-paths.ts
		/**
		* 从终端调用里抽取出**字面**删除路径（未知即保守，绝不猜）。
		*
		* dsh 没有专门的「删除文件」工具：Agent 只能走 Bash / Pwsh 终端删，原始
		* 命令行就躺在调用参数里。这里没有文件系统快照可比对，所以解析器刻意保守
		* ——只认那些**逐字**出现在已知删除命令参数位上的路径：
		*
		*  - 段里任何位置出现命令/进程替换（`$(…)`、反引号、`<(…)`），整段作废；
		*  - 参数里出现通配符（`* ? [`）或变量展开（`$`），该参数作废（事后无法
		*    枚举受影响集合）；
		*  - 按 shell 分隔符（`&&`、`||`、`|`、`;`、换行）切段，于是 `rm a && rm b`
		*    两个都报，而 `echo rm x` 一个都不报。
		*
		* 报出来的路径只是**展示用词汇**：文件已经不在了，既没有 hunk 也不能撤销。
		* `rm -r` 删掉的目录以其自身路径呈现。
		*/
		/** 参数位上逐字给出被删路径的命令（POSIX + PowerShell 别名）。 */
		const DELETERS = /* @__PURE__ */ new Set([
			"rm",
			"rmdir",
			"unlink",
			"shred",
			"trash",
			"remove-item",
			"ri",
			"del",
			"rd",
			"erase"
		]);
		/** Terminal tools whose arguments carry the raw command line (dsh 0.1.2 工具名）。 */
		const TERMINAL_TOOLS = /* @__PURE__ */ new Set([
			"bash",
			"pwsh",
			"terminal_send",
			"terminal_open"
		]);
		/** PowerShell 里「下一个参数才是路径」的参数名（`-Path` / `-LiteralPath`）。 */
		const PATH_PARAMETERS = /^-(path|literalpath)$/i;
		/** 这个 token 能否当作路径：含通配符 / 展开符，或只是 `.` / `..`，一律不算。 */
		function isPathlike(token) {
			if (token === "" || token === "." || token === "..") return false;
			return !/[*?\[\]$]/.test(token);
		}
		/**
		* 按 shell 分隔符把一条命令行切成若干段，同时尊重引号——引号里的 `;`
		* 不会把参数切开。
		*/
		function splitSegments(command) {
			const segments = [];
			let current = "";
			let quote = null;
			for (let at = 0; at < command.length; at += 1) {
				const char = command[at];
				if (quote !== null) {
					if (char === "\\") {
						const next = command[at + 1];
						if (quote === "\"" && next === "\"") {
							current += char + "\"";
							at += 1;
							continue;
						}
						current += char;
						continue;
					}
					if (char === quote) quote = null;
					current += char;
					continue;
				}
				if (char === "\"" || char === "'") {
					quote = char;
					current += char;
					continue;
				}
				const two = command.slice(at, at + 2);
				if (two === "&&" || two === "||") {
					segments.push(current);
					current = "";
					at += 1;
					continue;
				}
				if (char === "|" || char === ";" || char === "\n") {
					segments.push(current);
					current = "";
					continue;
				}
				current += char;
			}
			segments.push(current);
			return segments;
		}
		/**
		* 对一段命令行做类 shell 分词，引号并入 token 内部。
		*
		* 反斜杠语义取与 Windows 相关的那种读法：单引号内（bash / PowerShell 皆然）
		* 一切皆字面，未加引号的反斜杠同样是字面（PowerShell 路径）；只有在双引号
		* 内，反斜杠才转义闭合引号或它自己（bash）。末尾引号未闭合时，已收集到的
		* token 照常产出——宁可少认，不要崩。
		*/
		function tokenize$1(segment) {
			const tokens = [];
			let current = "";
			let quote = null;
			const flush = () => {
				if (current !== "") tokens.push(current);
				current = "";
			};
			for (let at = 0; at < segment.length; at += 1) {
				const char = segment[at];
				if (char === void 0) break;
				if (quote !== null) {
					if (char === "\\") {
						const next = segment[at + 1];
						if (quote === "\"" && (next === "\"" || next === "\\")) {
							current += next;
							at += 1;
							continue;
						}
						current += char;
						continue;
					}
					if (char === quote) {
						quote = null;
						continue;
					}
					current += char;
					continue;
				}
				if (char === "\"" || char === "'") {
					quote = char;
					continue;
				}
				if (/\s/.test(char)) {
					flush();
					continue;
				}
				current += char;
			}
			flush();
			return tokens;
		}
		/**
		* 一条终端命令行**逐字**点名的删除路径，按参数顺序、去重后返回。
		* 非字符串输入与非终端视图一律返回空——认不出来就不报。
		*/
		function deletedPathsFromCommand(command) {
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			const accept = (raw) => {
				for (const part of raw.split(",")) {
					if (!isPathlike(part) || seen.has(part)) continue;
					seen.add(part);
					paths.push(part);
				}
			};
			for (const segment of splitSegments(command)) {
				if (segment.includes("$(") || segment.includes("`") || segment.includes("<(")) continue;
				const tokens = tokenize$1(segment);
				let at = 0;
				while (at < tokens.length) {
					const head = tokens[at];
					if (head === void 0 || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) break;
					at += 1;
				}
				const commandWord = tokens[at];
				if (commandWord === void 0) continue;
				const basename = commandWord.slice(Math.max(commandWord.lastIndexOf("/"), commandWord.lastIndexOf("\\")) + 1);
				if (!DELETERS.has(basename.toLowerCase())) continue;
				for (let index = at + 1; index < tokens.length; index += 1) {
					const token = tokens[index];
					if (token === void 0) continue;
					if (token.startsWith("-")) {
						if (PATH_PARAMETERS.test(token) && index + 1 < tokens.length) {
							index += 1;
							const named = tokens[index];
							if (named !== void 0) accept(named);
						}
						continue;
					}
					accept(token);
				}
			}
			return paths;
		}
		/**
		* 一次工具调用报出的删除路径：只有终端工具在 `arguments.command` 里带原始
		* 命令行（dsh 0.1.2 起调用视图被移除，命令行直接从会话事件的 `tool/call`
		* 参数解析）。其它工具一律声明「没有删除」。
		*/
		function deletedPathsFromCall(name, argsRaw) {
			if (!TERMINAL_TOOLS.has(name)) return [];
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch {
				return [];
			}
			if (typeof args !== "object" || args === null || Array.isArray(args)) return [];
			const command = args.command;
			if (typeof command !== "string") return [];
			return deletedPathsFromCommand(command);
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/base.js
		var Diff = class {
			diff(oldStr, newStr, options = {}) {
				let callback;
				if (typeof options === "function") {
					callback = options;
					options = {};
				} else if ("callback" in options) callback = options.callback;
				const oldString = this.castInput(oldStr, options);
				const newString = this.castInput(newStr, options);
				const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
				const newTokens = this.removeEmpty(this.tokenize(newString, options));
				return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
			}
			diffWithOptionsObj(oldTokens, newTokens, options, callback) {
				var _a;
				const done = (value) => {
					value = this.postProcess(value, options);
					if (callback) {
						setTimeout(function() {
							callback(value);
						}, 0);
						return;
					} else return value;
				};
				const newLen = newTokens.length, oldLen = oldTokens.length;
				let editLength = 1;
				let maxEditLength = newLen + oldLen;
				if (options.maxEditLength != null) maxEditLength = Math.min(maxEditLength, options.maxEditLength);
				const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
				const abortAfterTimestamp = Date.now() + maxExecutionTime;
				const bestPath = [{
					oldPos: -1,
					lastComponent: void 0
				}];
				let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
				if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
				let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
				const execEditLength = () => {
					for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
						let basePath;
						const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
						if (removePath) bestPath[diagonalPath - 1] = void 0;
						let canAdd = false;
						if (addPath) {
							const addPathNewPos = addPath.oldPos - diagonalPath;
							canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
						}
						const canRemove = removePath && removePath.oldPos + 1 < oldLen;
						if (!canAdd && !canRemove) {
							bestPath[diagonalPath] = void 0;
							continue;
						}
						if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) basePath = this.addToPath(addPath, true, false, 0, options);
						else basePath = this.addToPath(removePath, false, true, 1, options);
						newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
						if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
						else {
							bestPath[diagonalPath] = basePath;
							if (basePath.oldPos + 1 >= oldLen) maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
							if (newPos + 1 >= newLen) minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
						}
					}
					editLength++;
				};
				if (callback) (function exec() {
					setTimeout(function() {
						if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) return callback(void 0);
						if (!execEditLength()) exec();
					}, 0);
				})();
				else while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
					const ret = execEditLength();
					if (ret) return ret;
				}
			}
			addToPath(path, added, removed, oldPosInc, options) {
				const last = path.lastComponent;
				if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) return {
					oldPos: path.oldPos + oldPosInc,
					lastComponent: {
						count: last.count + 1,
						added,
						removed,
						previousComponent: last.previousComponent
					}
				};
				else return {
					oldPos: path.oldPos + oldPosInc,
					lastComponent: {
						count: 1,
						added,
						removed,
						previousComponent: last
					}
				};
			}
			extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
				const newLen = newTokens.length, oldLen = oldTokens.length;
				let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
				while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
					newPos++;
					oldPos++;
					commonCount++;
					if (options.oneChangePerToken) basePath.lastComponent = {
						count: 1,
						previousComponent: basePath.lastComponent,
						added: false,
						removed: false
					};
				}
				if (commonCount && !options.oneChangePerToken) basePath.lastComponent = {
					count: commonCount,
					previousComponent: basePath.lastComponent,
					added: false,
					removed: false
				};
				basePath.oldPos = oldPos;
				return newPos;
			}
			equals(left, right, options) {
				if (options.comparator) return options.comparator(left, right);
				else return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
			}
			removeEmpty(array) {
				const ret = [];
				for (let i = 0; i < array.length; i++) if (array[i]) ret.push(array[i]);
				return ret;
			}
			castInput(value, options) {
				return value;
			}
			tokenize(value, options) {
				return Array.from(value);
			}
			join(chars) {
				return chars.join("");
			}
			postProcess(changeObjects, options) {
				return changeObjects;
			}
			get useLongestToken() {
				return false;
			}
			buildValues(lastComponent, newTokens, oldTokens) {
				const components = [];
				let nextComponent;
				while (lastComponent) {
					components.push(lastComponent);
					nextComponent = lastComponent.previousComponent;
					delete lastComponent.previousComponent;
					lastComponent = nextComponent;
				}
				components.reverse();
				const componentLen = components.length;
				let componentPos = 0, newPos = 0, oldPos = 0;
				for (; componentPos < componentLen; componentPos++) {
					const component = components[componentPos];
					if (!component.removed) {
						if (!component.added && this.useLongestToken) {
							let value = newTokens.slice(newPos, newPos + component.count);
							value = value.map(function(value, i) {
								const oldValue = oldTokens[oldPos + i];
								return oldValue.length > value.length ? oldValue : value;
							});
							component.value = this.join(value);
						} else component.value = this.join(newTokens.slice(newPos, newPos + component.count));
						newPos += component.count;
						if (!component.added) oldPos += component.count;
					} else {
						component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
						oldPos += component.count;
					}
				}
				return components;
			}
		};
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/character.js
		var CharacterDiff = class extends Diff {};
		new CharacterDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/util/string.js
		function longestCommonPrefix(str1, str2) {
			let i;
			for (i = 0; i < str1.length && i < str2.length; i++) if (str1[i] != str2[i]) return str1.slice(0, i);
			return str1.slice(0, i);
		}
		function longestCommonSuffix(str1, str2) {
			let i;
			if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) return "";
			for (i = 0; i < str1.length && i < str2.length; i++) if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) return str1.slice(-i);
			return str1.slice(-i);
		}
		function replacePrefix(string, oldPrefix, newPrefix) {
			if (string.slice(0, oldPrefix.length) != oldPrefix) throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
			return newPrefix + string.slice(oldPrefix.length);
		}
		function replaceSuffix(string, oldSuffix, newSuffix) {
			if (!oldSuffix) return string + newSuffix;
			if (string.slice(-oldSuffix.length) != oldSuffix) throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
			return string.slice(0, -oldSuffix.length) + newSuffix;
		}
		function removePrefix(string, oldPrefix) {
			return replacePrefix(string, oldPrefix, "");
		}
		function removeSuffix(string, oldSuffix) {
			return replaceSuffix(string, oldSuffix, "");
		}
		function maximumOverlap(string1, string2) {
			return string2.slice(0, overlapCount(string1, string2));
		}
		function overlapCount(a, b) {
			let startA = 0;
			if (a.length > b.length) startA = a.length - b.length;
			let endB = b.length;
			if (a.length < b.length) endB = a.length;
			const map = Array(endB);
			let k = 0;
			map[0] = 0;
			for (let j = 1; j < endB; j++) {
				if (b[j] == b[k]) map[j] = map[k];
				else map[j] = k;
				while (k > 0 && b[j] != b[k]) k = map[k];
				if (b[j] == b[k]) k++;
			}
			k = 0;
			for (let i = startA; i < a.length; i++) {
				while (k > 0 && a[i] != b[k]) k = map[k];
				if (a[i] == b[k]) k++;
			}
			return k;
		}
		/**
		* Split a string into segments using a word segmenter, merging consecutive
		* segments if they are both whitespace segments. Whitespace segments can
		* appear adjacent to one another for two reasons:
		* - newlines always get their own segment
		* - where a diacritic is attached to a whitespace character in the text, the
		*   segment ends after the diacritic, so e.g. " \u0300 " becomes two segments.
		* This function therefore runs the segmenter's .segment() method and then
		* merges consecutive segments of whitespace into a single part.
		*/
		function segment(string, segmenter) {
			const parts = [];
			for (const segmentObj of Array.from(segmenter.segment(string))) {
				const segment = segmentObj.segment;
				if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment)) parts[parts.length - 1] += segment;
				else parts.push(segment);
			}
			return parts;
		}
		function trailingWs(string, segmenter) {
			if (segmenter) return leadingAndTrailingWs(string, segmenter)[1];
			let i;
			for (i = string.length - 1; i >= 0; i--) if (!string[i].match(/\s/)) break;
			return string.substring(i + 1);
		}
		function leadingWs(string, segmenter) {
			if (segmenter) return leadingAndTrailingWs(string, segmenter)[0];
			const match = string.match(/^\s*/);
			return match ? match[0] : "";
		}
		function leadingAndTrailingWs(string, segmenter) {
			if (!segmenter) return [leadingWs(string), trailingWs(string)];
			if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
			const segments = segment(string, segmenter);
			const firstSeg = segments[0];
			const lastSeg = segments[segments.length - 1];
			return [/\s/.test(firstSeg) ? firstSeg : "", /\s/.test(lastSeg) ? lastSeg : ""];
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/word.js
		const extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
		const tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");
		var WordDiff = class extends Diff {
			equals(left, right, options) {
				if (options.ignoreCase) {
					left = left.toLowerCase();
					right = right.toLowerCase();
				}
				return left.trim() === right.trim();
			}
			tokenize(value, options = {}) {
				let parts;
				if (options.intlSegmenter) {
					const segmenter = options.intlSegmenter;
					if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
					parts = segment(value, segmenter);
				} else parts = value.match(tokenizeIncludingWhitespace) || [];
				const tokens = [];
				let prevPart = null;
				parts.forEach((part) => {
					if (/\s/.test(part)) {
						if (prevPart == null) tokens.push(part);
						else tokens.push(tokens.pop() + part);
					} else if (prevPart != null && /\s/.test(prevPart)) {
						if (tokens[tokens.length - 1] == prevPart) tokens.push(tokens.pop() + part);
						else tokens.push(prevPart + part);
					} else tokens.push(part);
					prevPart = part;
				});
				return tokens;
			}
			join(tokens) {
				return tokens.map((token, i) => {
					if (i == 0) return token;
					else return token.replace(/^\s+/, "");
				}).join("");
			}
			postProcess(changes, options) {
				if (!changes || options.oneChangePerToken) return changes;
				let lastKeep = null;
				let insertion = null;
				let deletion = null;
				changes.forEach((change) => {
					if (change.added) insertion = change;
					else if (change.removed) deletion = change;
					else {
						if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
						lastKeep = change;
						insertion = null;
						deletion = null;
					}
				});
				if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
				return changes;
			}
		};
		new WordDiff();
		function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
			if (deletion && insertion) {
				const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
				const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
				if (startKeep) {
					const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
					startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
					deletion.value = removePrefix(deletion.value, commonWsPrefix);
					insertion.value = removePrefix(insertion.value, commonWsPrefix);
				}
				if (endKeep) {
					const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
					endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
					deletion.value = removeSuffix(deletion.value, commonWsSuffix);
					insertion.value = removeSuffix(insertion.value, commonWsSuffix);
				}
			} else if (insertion) {
				if (startKeep) {
					const ws = leadingWs(insertion.value, segmenter);
					insertion.value = insertion.value.substring(ws.length);
				}
				if (endKeep) {
					const ws = leadingWs(endKeep.value, segmenter);
					endKeep.value = endKeep.value.substring(ws.length);
				}
			} else if (startKeep && endKeep) {
				const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
				const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
				deletion.value = removePrefix(deletion.value, newWsStart);
				const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
				deletion.value = removeSuffix(deletion.value, newWsEnd);
				endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
				startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
			} else if (endKeep) {
				const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
				const overlap = maximumOverlap(trailingWs(deletion.value, segmenter), endKeepWsPrefix);
				deletion.value = removeSuffix(deletion.value, overlap);
			} else if (startKeep) {
				const overlap = maximumOverlap(trailingWs(startKeep.value, segmenter), leadingWs(deletion.value, segmenter));
				deletion.value = removePrefix(deletion.value, overlap);
			}
		}
		var WordsWithSpaceDiff = class extends Diff {
			tokenize(value) {
				const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
				return value.match(regex) || [];
			}
		};
		new WordsWithSpaceDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/line.js
		var LineDiff = class extends Diff {
			constructor() {
				super(...arguments);
				this.tokenize = tokenize;
			}
			equals(left, right, options) {
				if (options.ignoreWhitespace) {
					if (!options.newlineIsToken || !left.includes("\n")) left = left.trim();
					if (!options.newlineIsToken || !right.includes("\n")) right = right.trim();
				} else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
					if (left.endsWith("\n")) left = left.slice(0, -1);
					if (right.endsWith("\n")) right = right.slice(0, -1);
				}
				return super.equals(left, right, options);
			}
		};
		new LineDiff();
		function tokenize(value, options) {
			if (options.stripTrailingCr) value = value.replace(/\r\n/g, "\n");
			const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
			if (!linesAndNewlines[linesAndNewlines.length - 1]) linesAndNewlines.pop();
			for (let i = 0; i < linesAndNewlines.length; i++) {
				const line = linesAndNewlines[i];
				if (i % 2 && !options.newlineIsToken) retLines[retLines.length - 1] += line;
				else retLines.push(line);
			}
			return retLines;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/sentence.js
		function isSentenceEndPunct(char) {
			return char == "." || char == "!" || char == "?";
		}
		var SentenceDiff = class extends Diff {
			tokenize(value) {
				var _a;
				const result = [];
				let tokenStartI = 0;
				for (let i = 0; i < value.length; i++) {
					if (i == value.length - 1) {
						result.push(value.slice(tokenStartI));
						break;
					}
					if (isSentenceEndPunct(value[i]) && value[i + 1].match(/\s/)) {
						result.push(value.slice(tokenStartI, i + 1));
						i = tokenStartI = i + 1;
						while ((_a = value[i + 1]) === null || _a === void 0 ? void 0 : _a.match(/\s/)) i++;
						result.push(value.slice(tokenStartI, i + 1));
						tokenStartI = i + 1;
					}
				}
				return result;
			}
		};
		new SentenceDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/css.js
		var CssDiff = class extends Diff {
			tokenize(value) {
				return value.split(/([{}:;,]|\s+)/);
			}
		};
		new CssDiff();
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/json.js
		var JsonDiff = class extends Diff {
			constructor() {
				super(...arguments);
				this.tokenize = tokenize;
			}
			get useLongestToken() {
				return true;
			}
			castInput(value, options) {
				const { undefinedReplacement, stringifyReplacer = (k, v) => typeof v === "undefined" ? undefinedReplacement : v } = options;
				return typeof value === "string" ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, "  ");
			}
			equals(left, right, options) {
				return super.equals(left.replace(/,([\r\n])/g, "$1"), right.replace(/,([\r\n])/g, "$1"), options);
			}
		};
		new JsonDiff();
		function canonicalize(obj, stack, replacementStack, replacer, key) {
			stack = stack || [];
			replacementStack = replacementStack || [];
			if (replacer) obj = replacer(key === void 0 ? "" : key, obj);
			let i;
			for (i = 0; i < stack.length; i += 1) if (stack[i] === obj) return replacementStack[i];
			let canonicalizedObj;
			if ("[object Array]" === Object.prototype.toString.call(obj)) {
				stack.push(obj);
				canonicalizedObj = new Array(obj.length);
				replacementStack.push(canonicalizedObj);
				for (i = 0; i < obj.length; i += 1) canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
				stack.pop();
				replacementStack.pop();
				return canonicalizedObj;
			}
			if (obj && obj.toJSON) obj = obj.toJSON();
			if (typeof obj === "object" && obj !== null) {
				stack.push(obj);
				canonicalizedObj = {};
				replacementStack.push(canonicalizedObj);
				const sortedKeys = [];
				let key;
				for (key in obj)
 /* istanbul ignore else */
				if (Object.prototype.hasOwnProperty.call(obj, key)) sortedKeys.push(key);
				sortedKeys.sort();
				for (i = 0; i < sortedKeys.length; i += 1) {
					key = sortedKeys[i];
					canonicalizedObj[key] = canonicalize(obj[key], stack, replacementStack, replacer, key);
				}
				stack.pop();
				replacementStack.pop();
			} else canonicalizedObj = obj;
			return canonicalizedObj;
		}
		//#endregion
		//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/array.js
		var ArrayDiff = class extends Diff {
			tokenize(value) {
				return value.slice();
			}
			join(value) {
				return value;
			}
			removeEmpty(value) {
				return value;
			}
		};
		const arrayDiff = new ArrayDiff();
		function diffArrays(oldArr, newArr, options) {
			return arrayDiff.diff(oldArr, newArr, options);
		}
		//#endregion
		//#region src/client/diff-text.ts
		/**
		* 把 diff 的一侧切成内容行。
		*
		* 刻意不为结尾的行终止符额外造出一个空行——`'\n'.split('\n')` 会得到
		* `['', '']`，凭空多一行「改动」；行数统计与 hunk 起止都会因此偏一位。
		*/
		/**
		* 切出 `text` 的内容行（不含结尾换行）。
		* 空串返回空数组而不是 `['']`：没有内容就是没有行。
		*/
		function diffContentLines(text) {
			if (text === "") return [];
			return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
		}
		//#endregion
		//#region src/client/recorded-diffs.ts
		/**
		* 从一条录制的 Code Mode 变更的**完整 before / after 内容**反推行级审查 hunk。
		*
		* 为什么必须反推：携带可复用 hunk 的线上视图只挂在模型直发的 tool/call 帧
		* 上；`run_code` 的嵌套派发记录下来的只有原始值。本模块因此把同样的 hunk
		* 形状（带行锚点的 `ProducedFileDiff`）重建出来——tab 的其余部分负责渲染它，
		* 宿主撤销服务负责应用它，两边都不需要知道它来自录制。
		*/
		/** 每个改动run 前后保留的未变更行数（对齐 unified diff 的观感）。 */
		const CONTEXT_LINES = 3;
		/** 数出 hunk 末尾有多少行是两侧相同的上下文。 */
		function trailingContext(hunk) {
			let count = 0;
			const max = Math.min(hunk.old.length, hunk.new.length);
			for (let offset = 1; offset <= max; offset += 1) {
				if (hunk.old[hunk.old.length - offset] !== hunk.new[hunk.new.length - offset]) break;
				count += 1;
			}
			return count;
		}
		/**
		* 一次文件变更的行级 hunk；文件是新建的（`before === null`）时返回单条整文件
		* 条目（与 write 工具的 null 内容卡片同形）。变更没有实际改动文件时返回 []。
		*/
		function diffsFromBeforeAfter(path, before, after) {
			if (before === null) return after === "" ? [] : [{
				path,
				oldText: null,
				newText: after
			}];
			const oldLines = diffContentLines(before);
			const newLines = diffContentLines(after);
			if (oldLines.length === 0 && newLines.length === 0) return [];
			if (oldLines.join("\n") === newLines.join("\n")) return [];
			const hunks = [];
			const changes = diffArrays(oldLines, newLines);
			let contextBuffer = [];
			let oldCursor = 1;
			let newCursor = 1;
			let hunk = null;
			for (const change of changes) {
				if (!change.removed && !change.added) {
					const run = change.value;
					if (hunk !== null) {
						const beforeLen = hunk.old.length;
						hunk.old.push(...run);
						hunk.new.push(...run);
						oldCursor += run.length;
						newCursor += run.length;
						if (run.length > 6) {
							const target = beforeLen + CONTEXT_LINES;
							hunk.old.length = target;
							hunk.new.length = target;
							contextBuffer = run.slice(-3);
							hunk = null;
						}
					} else {
						contextBuffer.push(...run);
						oldCursor += run.length;
						newCursor += run.length;
						if (contextBuffer.length > CONTEXT_LINES) contextBuffer = contextBuffer.slice(-3);
					}
					continue;
				}
				const removed = change.removed ? change.value : [];
				const added = change.added ? change.value : [];
				if (hunk === null) {
					const leading = contextBuffer;
					hunk = {
						oldStart: oldCursor - leading.length,
						newStart: newCursor - leading.length,
						old: [...leading],
						new: [...leading]
					};
					hunks.push(hunk);
				}
				hunk.old.push(...removed);
				hunk.new.push(...added);
				oldCursor += removed.length;
				newCursor += added.length;
			}
			for (const current of hunks) {
				const extra = Math.max(0, trailingContext(current) - CONTEXT_LINES);
				if (extra > 0) {
					current.old.length -= extra;
					current.new.length -= extra;
				}
			}
			return hunks.filter((hunkEntry) => hunkEntry.old.length > 0 || hunkEntry.new.length > 0).map((hunkEntry) => ({
				path,
				oldText: hunkEntry.old.join("\n"),
				newText: hunkEntry.new.join("\n"),
				oldStart: hunkEntry.oldStart,
				newStart: hunkEntry.newStart
			}));
		}
		//#endregion
		//#region src/client/session-changes.ts
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function parseArgs$1(argsRaw) {
			try {
				const args = JSON.parse(argsRaw);
				return isRecord$1(args) ? args : null;
			} catch {
				return null;
			}
		}
		function pathValue$1(value) {
			return typeof value === "string" && value !== "" ? value : null;
		}
		/** 校验跨宿主/浏览器传输进来的 diff hunks（未知即拒绝，绝不猜）。 */
		function producedDiffs$1(meta) {
			if (!isRecord$1(meta) || !Array.isArray(meta.diffs)) return [];
			const diffs = [];
			for (const value of meta.diffs) {
				if (!isRecord$1(value)) return rejectDiffs$1(meta.diffs.length);
				const { path, oldText, newText, oldStart, newStart } = value;
				if (typeof path !== "string" || oldText !== null && typeof oldText !== "string" || typeof newText !== "string" || oldStart !== void 0 && (typeof oldStart !== "number" || !Number.isInteger(oldStart) || oldStart < 1) || newStart !== void 0 && (typeof newStart !== "number" || !Number.isInteger(newStart) || newStart < 1)) return rejectDiffs$1(meta.diffs.length);
				diffs.push({
					path,
					oldText,
					newText,
					...typeof oldStart === "number" ? { oldStart } : {},
					...typeof newStart === "number" ? { newStart } : {}
				});
			}
			return diffs;
		}
		/** 一条 hunk 形状不完整就整组丢弃是刻意设计（宿主撤销要求全量可逆）；
		* 但静默丢弃曾让「文件在列、撤销永久禁用」无从排查——至少留痕。 */
		function rejectDiffs$1(total) {
			console.warn(`[dsh-shadow-rewind] diff 视图中存在不可解析的 hunk，整组丢弃（共 ${String(total)} 条）`);
			return [];
		}
		/**
		* 一个根变更调用的产出路径（按渲染意图，即工具名：`write` / `edit` /
		* `str_replace_editor`）。其余工具一律没有产出——读就是看了看，终端就是跑了
		* 一跑。
		*/
		function producedPathsOfCall(name, argsRaw) {
			const args = parseArgs$1(argsRaw);
			if (args === null) return [];
			switch (name) {
				case "write":
				case "edit": return pathValue$1(args.file_path) !== null ? [args.file_path] : [];
				case "str_replace_editor": return pathValue$1(args.path) !== null ? [args.path] : [];
				default: return [];
			}
		}
		/** 优先取落地结果 hunks；结果没带 meta 时退回调用意图直译的 hunks。 */
		function reviewDiffs(node) {
			const fromMeta = producedDiffs$1(node.meta);
			if (fromMeta.length > 0) return fromMeta;
			const call = node.call;
			if (call === null) return [];
			const args = parseArgs$1(call.argsRaw);
			if (args === null) return [];
			switch (call.name) {
				case "write": {
					const path = pathValue$1(args.file_path);
					const content = args.content;
					return path === null || typeof content !== "string" ? [] : [{
						path,
						oldText: null,
						newText: content
					}];
				}
				case "edit": {
					const path = pathValue$1(args.file_path);
					const { old_string: oldString, new_string: newString } = args;
					return path === null || typeof oldString !== "string" || typeof newString !== "string" || oldString === "" || oldString === newString ? [] : [{
						path,
						oldText: oldString,
						newText: newString
					}];
				}
				case "str_replace_editor": {
					const path = pathValue$1(args.path);
					if (path === null) return [];
					if (args.command === "create" && typeof args.file_text === "string") return [{
						path,
						oldText: null,
						newText: args.file_text
					}];
					if (args.command === "str_replace" && typeof args.old_str === "string" && typeof args.new_str === "string" && args.old_str !== "") return [{
						path,
						oldText: args.old_str,
						newText: args.new_str
					}];
					return [];
				}
				default: return [];
			}
		}
		/**
		* 把一个事件 seq 归属到它所属的轮。已完结轮占有直到自己 `turn/end` seq 的
		* seq 区间；超出最后一个已完结 end 的统统属于 live 轮——即进行中的
		* `partial` / running 调用所在轮，或当没有任何 live 信号可观察时的「下一轮」。
		*/
		function turnAttribution(legacy) {
			const ends = [...legacy.turnEnds.entries()].sort((a, b) => a[1] - b[1]);
			const liveTurn = legacy.partial?.turn ?? legacy.runningCalls[0]?.turn ?? (ends.at(-1)?.[0] ?? 0) + 1;
			return (seq) => {
				for (const [turn, endSeq] of ends) if (endSeq >= seq) return {
					turn,
					live: false
				};
				return {
					turn: liveTurn,
					live: true
				};
			};
		}
		/** 推导一个会话的逐轮产出文件变更（无缓存的实现核心）。 */
		function derive(snapshot) {
			const legacy = snapshot.legacy;
			const attribute = turnAttribution(legacy);
			const byTurn = /* @__PURE__ */ new Map();
			for (const node of legacy.nodes) {
				if (node.kind !== "tool-result" || node.isError) continue;
				if (node.parentCallId !== void 0) continue;
				const call = node.call;
				if (call === null) continue;
				const paths = producedPathsOfCall(call.name, call.argsRaw);
				const deletions = paths.length === 0 ? deletedPathsFromCall(call.name, call.argsRaw) : [];
				if (paths.length === 0 && deletions.length === 0) continue;
				const diffs = reviewDiffs(node);
				const { turn, live } = attribute(node.seq);
				let group = byTurn.get(turn);
				if (group === void 0) {
					group = {
						live,
						files: /* @__PURE__ */ new Map()
					};
					byTurn.set(turn, group);
				}
				for (const path of paths) {
					const own = diffs.filter((diff) => diff.path === path);
					const existing = group.files.get(path);
					if (existing === void 0) group.files.set(path, { diffs: [...own] });
					else {
						existing.diffs.push(...own);
						delete existing.deleted;
					}
				}
				for (const path of deletions) {
					const existing = group.files.get(path);
					if (existing === void 0) group.files.set(path, {
						diffs: [],
						deleted: true
					});
					else existing.deleted = true;
				}
			}
			return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([turn, group]) => ({
				turn,
				live: group.live,
				files: [...group.files.entries()].map(([path, own]) => ({
					path,
					diffs: own.diffs,
					...own.deleted === true ? { deleted: true } : {}
				}))
			}));
		}
		/**
		* 快照同一性缓存：侧边栏徽标在每次 tab-bar 渲染都会跑这个推导，结果因此按
		* 不可变快照引用记忆化（会话只在内容真正变化时才发布新引用，WeakMap 键正好
		* 适配——快照不再被引用时条目随之可回收）。
		*/
		const cache = /* @__PURE__ */ new WeakMap();
		/** 对某个会话快照推导逐轮产出文件变更（带缓存入口）。 */
		function deriveSessionChanges(snapshot) {
			if (snapshot === null || snapshot === void 0) return [];
			const hit = cache.get(snapshot);
			if (hit !== void 0) return hit;
			const derived = derive(snapshot);
			cache.set(snapshot, derived);
			return derived;
		}
		/** 窗口内的全部 `run_code` 工具结果节点，按节点顺序。 */
		function deriveSessionRoots(snapshot) {
			const legacy = snapshot.legacy;
			const attribute = turnAttribution(legacy);
			const roots = [];
			for (const node of legacy.nodes) {
				if (node.kind !== "tool-result" || node.isError) continue;
				if (node.subCalls.length === 0) continue;
				const { turn, live } = attribute(node.seq);
				roots.push({
					turn,
					live,
					rootCallId: node.callId
				});
			}
			return roots;
		}
		/**
		* 把宿主录制到的 Code Mode 变更合并进快照推导出的各轮：由完整 before / after
		* 重建的 hunks 追加到所属轮的文件组里（同路径条目保持一行，hunks 按派发顺序
		* 追加），于是 tab 的 diff 渲染、状态巡检与撤销对程序化改动与模型直发完全
		* 同路。所有入参都不可变；只有某条录制变更匹配上了可见根调用时，结果才是
		* 新数组（否则原样返回，避免无谓重渲染）。
		*/
		function mergeRecordedTurns(turns, roots, recorded) {
			if (recorded.length === 0 || roots.length === 0) return turns;
			const rootTurns = /* @__PURE__ */ new Map();
			for (const root of roots) rootTurns.set(root.rootCallId, {
				turn: root.turn,
				live: root.live
			});
			const byRoot = /* @__PURE__ */ new Map();
			for (const mutation of recorded) {
				const list = byRoot.get(mutation.rootCallId);
				if (list === void 0) byRoot.set(mutation.rootCallId, [mutation]);
				else list.push(mutation);
			}
			let matched = false;
			for (const root of roots) if (byRoot.has(root.rootCallId)) {
				matched = true;
				break;
			}
			if (!matched) return turns;
			const groups = /* @__PURE__ */ new Map();
			for (const turn of turns) {
				const files = /* @__PURE__ */ new Map();
				for (const file of turn.files) files.set(file.path, {
					diffs: [...file.diffs],
					...file.deleted === true ? { deleted: true } : {}
				});
				groups.set(turn.turn, {
					live: turn.live,
					files
				});
			}
			for (const [rootCallId, mutations] of byRoot) {
				const owner = rootTurns.get(rootCallId);
				if (owner === void 0) continue;
				let group = groups.get(owner.turn);
				if (group === void 0) {
					group = {
						live: owner.live,
						files: /* @__PURE__ */ new Map()
					};
					groups.set(owner.turn, group);
				}
				for (const mutation of mutations) {
					const diffs = diffsFromBeforeAfter(mutation.path, mutation.before, mutation.after);
					if (diffs.length === 0) continue;
					const existing = group.files.get(mutation.path);
					if (existing === void 0) group.files.set(mutation.path, { diffs: [...diffs] });
					else existing.diffs.push(...diffs);
				}
			}
			return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([turn, group]) => ({
				turn,
				live: group.live,
				files: [...group.files.entries()].map(([path, own]) => ({
					path,
					diffs: own.diffs,
					...own.deleted === true ? { deleted: true } : {}
				}))
			}));
		}
		/** 统计跨所有轮的被改路径去重数（侧边栏徽标就是这个数）。 */
		function countChangedFiles(turns) {
			const paths = /* @__PURE__ */ new Set();
			for (const turn of turns) for (const file of turn.files) paths.add(file.path);
			return paths.size;
		}
		/** 路径末段——一眼就能认出文件的那一部分。 */
		function basename$1(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/** 绝对路径判定：POSIX 根、盘符根或 UNC 前缀，分隔符无关。 */
		function isAbsolutePath(path) {
			return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
		}
		/** 把（可能相对的）工具路径按会话工作区目录解析成展示路径。 */
		function resolveSessionPath(cwd, path) {
			if (isAbsolutePath(path)) return path;
			const base = cwd ?? "";
			if (base === "") return path;
			const separator = base.includes("\\") ? "\\" : "/";
			return `${base.replace(/[\\/]+$/, "")}${separator}${path}`;
		}
		//#endregion
		//#region src/client/fs-diff-utils.ts
		/** 与宿主 hunk 数学同一基准的换行归一（file-review-service 的 normalizeNewlines 语义）。 */
		function normalizeLf(text) {
			return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		}
		/** 归因字段投影（占位/补齐/提交各构造点共用）：全缺省时返回空对象。 */
		function fsAttributionOf(source) {
			return {
				...source.owner !== void 0 ? { owner: source.owner } : {},
				...source.autoSelect !== void 0 ? { autoSelect: source.autoSelect } : {},
				...source.attribution !== void 0 ? { attribution: source.attribution } : {},
				...source.command !== void 0 ? { command: source.command } : {},
				...source.writtenAt !== void 0 ? { writtenAt: source.writtenAt } : {}
			};
		}
		/**
		* 经 HTTP 按检查点读取文件内容。找不到或判定为二进制（NUL 字节守卫）时返回
		* null——调用方一律把 null 当作「全文不可得」，而不是空文件。
		*/
		async function fetchCheckpointFileContent(checkpointId, path, cwd) {
			try {
				const params = new URLSearchParams({
					checkpointId,
					path,
					cwd
				});
				const response = await fetch(`/shadow-rewind/file?${params}`, {
					headers: { accept: "application/json" },
					cache: "no-store"
				});
				if (!response.ok) return null;
				const data = await response.json();
				if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
				const record = data;
				if (typeof record.content !== "string" || record.encoding !== "base64") return null;
				const binary = atob(record.content);
				const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
				const text = new TextDecoder("utf-8").decode(bytes);
				return text.includes("\0") ? null : text;
			} catch {
				return null;
			}
		}
		/** 命令归因引用的宽松解析（形状非法返回 null）。 */
		function parseFsCommand(raw) {
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
			const record = raw;
			if (typeof record.tool !== "string" || record.tool === "") return null;
			if (typeof record.sessionId !== "string" || record.sessionId === "") return null;
			if (typeof record.startedAt !== "number" || typeof record.endedAt !== "number") return null;
			return {
				tool: record.tool,
				...typeof record.callId === "string" && record.callId !== "" ? { callId: record.callId } : {},
				sessionId: record.sessionId,
				startedAt: record.startedAt,
				endedAt: record.endedAt
			};
		}
		/**
		* 从批量端点拉取所有轮次的文件系统变更。
		* 宽松解析：未知 / 缺失字段一律降级（条目丢了就丢了），绝不因一个坏字段
		* 让整个审查面白屏。
		*/
		async function fetchAllFsChanges(sessionId) {
			try {
				const response = await fetch(`/shadow-rewind/fs-changes?sessionId=${encodeURIComponent(sessionId)}`, {
					headers: { accept: "application/json" },
					cache: "no-store"
				});
				if (!response.ok) return { turns: [] };
				const data = await response.json();
				if (typeof data !== "object" || data === null || Array.isArray(data)) return { turns: [] };
				const record = data;
				if (!Array.isArray(record.turns)) return { turns: [] };
				const turns = [];
				for (const entry of record.turns) {
					if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
					const item = entry;
					if (typeof item.turn !== "number" || typeof item.turnStartSeq !== "number") continue;
					if (typeof item.checkpointId !== "string" || typeof item.nextCheckpointId !== "string") continue;
					if (!Array.isArray(item.changes)) continue;
					const changes = item.changes.map((change) => {
						if (typeof change !== "object" || change === null || Array.isArray(change)) return null;
						const c = change;
						if (typeof c.path !== "string" || c.path === "") return null;
						const kind = c.kind === "added" || c.kind === "modified" || c.kind === "deleted" ? c.kind : null;
						if (kind === null) return null;
						const command = parseFsCommand(c.command);
						return {
							path: c.path,
							kind,
							...typeof c.added === "number" ? { added: c.added } : {},
							...typeof c.removed === "number" ? { removed: c.removed } : {},
							...typeof c.oldMode === "number" ? { oldMode: c.oldMode } : {},
							...typeof c.newMode === "number" ? { newMode: c.newMode } : {},
							...c.dir === true ? { dir: true } : {},
							...typeof c.owner === "string" && c.owner !== "" ? { owner: c.owner } : {},
							...typeof c.autoSelect === "boolean" ? { autoSelect: c.autoSelect } : {},
							...c.attribution === "command" || c.attribution === "ambiguous" || c.attribution === "external" || c.attribution === "window" || c.attribution === "unknown" ? { attribution: c.attribution } : {},
							...command === null ? {} : { command },
							...typeof c.writtenAt === "number" ? { writtenAt: c.writtenAt } : {}
						};
					}).filter((change) => change !== null);
					if (changes.length > 0) turns.push({
						turn: item.turn,
						turnStartSeq: item.turnStartSeq,
						checkpointId: item.checkpointId,
						nextCheckpointId: item.nextCheckpointId,
						...item.live === true ? { live: true } : {},
						changes
					});
				}
				return {
					turns,
					...typeof record.rev === "number" ? { rev: record.rev } : {}
				};
			} catch {
				return { turns: [] };
			}
		}
		const WARM_THROTTLE_MS = 2e3;
		const fsCache = /* @__PURE__ */ new Map();
		const warmLastAt = /* @__PURE__ */ new Map();
		const warmInFlight = /* @__PURE__ */ new Set();
		/** 每会话最近一次 fs-changes 的数据版本；rev 未变则整轮 warm 跳过。 */
		const warmLastRev = /* @__PURE__ */ new Map();
		const cacheListeners = /* @__PURE__ */ new Set();
		/** 订阅缓存刷新（卡片据此重新推导自己的 fs 条目）。 */
		function subscribeFsCache(listener) {
			cacheListeners.add(listener);
			return () => {
				cacheListeners.delete(listener);
			};
		}
		/** 广播缓存变化。 */
		function notifyFsCache() {
			for (const listener of cacheListeners) listener();
		}
		/** 供轮尾 select() 同步读取的入口：这一轮有 fs 变更吗？ */
		function cachedFsTurnFor(turnStartSeq) {
			return fsCache.get(turnStartSeq);
		}
		/**
		* 把某个会话的 fs-changes 预热进缓存（节流 + 发后不理）。
		* 热路径调用是安全的：徽标渲染、快照订阅都可以随手调一次。
		* rev 未变时（同构建宿主必带）直接跳过解析、缓存写入与通知——warm 的正确性
		* 不再依赖 JSON 深比较；rev 缺省（旧宿主）回退到逐条 JSON 比较。
		*/
		function warmFsChanges(sessionId) {
			const now = Date.now();
			if (now - (warmLastAt.get(sessionId) ?? 0) < WARM_THROTTLE_MS || warmInFlight.has(sessionId)) return;
			warmLastAt.set(sessionId, now);
			warmInFlight.add(sessionId);
			fetchAllFsChanges(sessionId).then((payload) => {
				warmInFlight.delete(sessionId);
				if (payload.rev !== void 0) {
					const previous = warmLastRev.get(sessionId);
					if (previous !== void 0 && previous === payload.rev) return;
					warmLastRev.set(sessionId, payload.rev);
				}
				let changed = false;
				for (const turn of payload.turns) {
					const stamped = {
						...turn,
						sessionId
					};
					const existing = fsCache.get(turn.turnStartSeq);
					if (existing === void 0 || JSON.stringify(existing) !== JSON.stringify(stamped)) {
						fsCache.set(turn.turnStartSeq, stamped);
						invalidateLazyTurn(turn.turnStartSeq);
						changed = true;
					}
				}
				if (changed) notifyFsCache();
			}).catch(() => {
				warmInFlight.delete(sessionId);
			});
		}
		/** 按「会话 + 轮」同步读取（live 条的查找键；缓存条目都带 sessionId）。 */
		function cachedFsTurnForSessionTurn(sessionId, turn) {
			for (const entry of fsCache.values()) if (entry.sessionId === sessionId && entry.turn === turn) return entry;
		}
		/** (turnStartSeq, path) → 全文条目的进行中/已完成请求。 */
		const lazyDiffs = /* @__PURE__ */ new Map();
		/** 懒加载记忆容量上限；超出淘汰最旧（会话数 × 轮数 × 文件数的防泄漏阀）。 */
		const LAZY_MEMO_CAP = 512;
		function lazyKey(turnStartSeq, path) {
			return `${String(turnStartSeq)}\u0000${path}`;
		}
		function invalidateLazyTurn(turnStartSeq) {
			const prefix = `${String(turnStartSeq)}\u0000`;
			for (const key of lazyDiffs.keys()) if (key.startsWith(prefix)) lazyDiffs.delete(key);
		}
		/**
		* 拉取前后检查点内容，为一个文件系统级变更生成 ProducedFileDiff。
		*
		* 形状契约与宿主对齐：新增文件的 `oldText = null`（宿主的 fs 撤销 = 删文件），
		* 删除文件的 `newText = ''`（宿主的 fs 撤销 = 写回旧内容）——两者都保持承载
		* 宿主文件存在性语义的单条整文件形状。**修改**文件则切出真正的行级 hunks
		* （与宿主 hunk 数学同一 LF 归一基准），多 hunk 的子集撤销因此与工具写入
		* 同路。`nextCheckpointId` 可能是 'live'（= 当前磁盘）。
		*/
		async function generateFsDiff(fsChange, checkpointId, nextCheckpointId, cwd) {
			const { path, kind } = fsChange;
			const modes = {
				...fsChange.oldMode !== void 0 ? { oldMode: fsChange.oldMode } : {},
				...fsChange.newMode !== void 0 ? { newMode: fsChange.newMode } : {}
			};
			if (kind === "added") {
				const content = await fetchCheckpointFileContent(nextCheckpointId, path, cwd);
				if (content === null) return null;
				return [{
					path,
					oldText: null,
					newText: content,
					...modes
				}];
			}
			if (kind === "deleted") {
				const content = await fetchCheckpointFileContent(checkpointId, path, cwd);
				if (content === null) return null;
				return [{
					path,
					oldText: content,
					newText: "",
					...modes
				}];
			}
			const [oldContent, newContent] = await Promise.all([fetchCheckpointFileContent(checkpointId, path, cwd), fetchCheckpointFileContent(nextCheckpointId, path, cwd)]);
			if (oldContent === null || newContent === null) return null;
			const oldLf = normalizeLf(oldContent);
			const newLf = normalizeLf(newContent);
			if (oldLf === newLf) return [{
				path,
				oldText: oldContent,
				newText: newContent,
				...modes
			}];
			const hunks = diffsFromBeforeAfter(path, oldLf, newLf);
			if (hunks.length === 0) return [{
				path,
				oldText: oldContent,
				newText: newContent,
				...modes
			}];
			return hunks.map((hunk) => ({
				...hunk,
				...modes
			}));
		}
		/**
		* 一个 fs 条目的占位形态：零全文、带服务端行数。卡片/侧边栏/live 条先用它
		* 渲染行与 +/−，内容在悬停、展开或撤销时经 ensureFsFileDiff 按需补齐。
		*/
		function fsTurnReviews(fsTurn) {
			return fsTurn.changes.map((change) => ({
				path: change.path,
				diffs: [],
				origin: "fs",
				...change.dir === true ? { dir: true } : {},
				...change.added !== void 0 || change.removed !== void 0 ? { counts: {
					added: change.added ?? 0,
					removed: change.removed ?? 0
				} } : {},
				...change.kind === "deleted" ? { deleted: true } : {}
			}));
		}
		/**
		* 取一个 fs 条目的完整全文条目（撤销/展示 diff 用）。同一 (turn, path) 的
		* 并发与后续调用复用同一个请求；该轮缓存条目被 warm 替换时记忆自动失效
		* （live 条的磁盘内容会随回合推进而变化，绝不能跨更新复用）。
		*/
		function ensureFsFileDiff(fsTurn, path, cwd) {
			const change = fsTurn.changes.find((entry) => entry.path === path);
			if (change === void 0) return Promise.resolve(null);
			const key = lazyKey(fsTurn.turnStartSeq, path);
			const cached = lazyDiffs.get(key);
			if (cached !== void 0) return cached;
			const task = (async () => {
				const attribution = fsAttributionOf(change);
				if (change.dir === true) return {
					path,
					diffs: [{
						path,
						oldText: null,
						newText: ""
					}],
					origin: "fs",
					dir: true,
					...change.kind === "deleted" ? { deleted: true } : {},
					...attribution
				};
				const diffs = await generateFsDiff(change, fsTurn.checkpointId, fsTurn.nextCheckpointId, cwd);
				if (diffs === null) return null;
				return {
					path,
					diffs,
					origin: "fs",
					...change.kind === "deleted" ? { deleted: true } : {},
					...attribution
				};
			})();
			if (lazyDiffs.size >= LAZY_MEMO_CAP) {
				const oldest = lazyDiffs.keys().next().value;
				if (oldest !== void 0) lazyDiffs.delete(oldest);
			}
			lazyDiffs.set(key, task);
			return task;
		}
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
		//#region \0dsh-shadow-rewind-css:D:\dsh-pulgn\dsh-shadow-rewind\src\client\UnifiedDiff.module.css.mjs
		const css$2 = ".GmhTJW_unifiedBlock{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin:16px 0;position:relative;overflow:hidden}.GmhTJW_unifiedEmbedded{border:0;border-radius:0;margin:0}.GmhTJW_unifiedCopyButton{z-index:2;color:var(--dsw-alias-label-secondary);cursor:pointer;font:var(--dsw-font-xs-13);background:0 0;border:0;padding:0;position:absolute;top:10px;right:12px}.GmhTJW_unifiedNav{z-index:2;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);font-variant-numeric:tabular-nums;align-items:center;gap:4px;display:flex;position:absolute;top:6px;right:56px}.GmhTJW_unifiedNav button{color:var(--dsw-alias-label-secondary);cursor:pointer;font:var(--dsw-font-xs-13);background:0 0;border:0;padding:0 6px}.GmhTJW_unifiedNav button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.GmhTJW_unifiedNav button:disabled{opacity:.4;cursor:default}.GmhTJW_unifiedFile+.GmhTJW_unifiedFile{border-top:1px solid var(--dsw-alias-border-l2)}.GmhTJW_unifiedHeader{border-bottom:1px solid var(--dsw-alias-border-l2);min-height:38px;font:var(--dsw-font-markdown-code-block);align-items:center;gap:8px;padding:0 72px 0 12px;display:flex}.GmhTJW_unifiedStatus{color:var(--dsw-alias-state-success-primary);font-weight:700}.GmhTJW_unifiedPath{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.GmhTJW_unifiedAdded{color:var(--dsw-alias-state-success-primary);margin-left:auto}.GmhTJW_unifiedRemoved{color:var(--dsw-alias-state-error-primary)}.GmhTJW_unifiedHunkHeader{border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block);padding:6px 12px}.GmhTJW_unifiedBody{font:var(--dsw-font-markdown-code-block);overflow:auto hidden}.GmhTJW_unifiedLine{white-space:pre;grid-template-columns:48px 24px minmax(max-content,1fr);min-width:max-content;min-height:23px;line-height:23px;display:grid}.GmhTJW_unifiedLineNumber{border-right:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);text-align:right;user-select:none;padding:0 8px}.GmhTJW_unifiedSign{text-align:center;user-select:none}.GmhTJW_unifiedText{padding-right:14px}.GmhTJW_unified_del{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 11%, transparent)}.GmhTJW_unified_add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent)}.GmhTJW_unified_context{color:var(--dsw-alias-label-primary)}.GmhTJW_unifiedHighlight{text-underline-offset:3px;font-weight:600;text-decoration:underline}.GmhTJW_unifiedGap{border:0;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-border-l1);width:100%;min-height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:var(--dsw-font-xs-13);text-align:left;padding:0 12px 0 72px;display:block}.GmhTJW_unifiedGap:hover{color:var(--dsw-alias-label-primary)}.GmhTJW_unifiedOmitted{border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-border-l1);min-height:32px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);align-items:center;gap:12px;padding:0 12px;display:flex}.GmhTJW_unifiedHunkBar{border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent);min-height:28px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);align-items:center;padding:0 12px;display:flex}.GmhTJW_unifiedHunkSelect{cursor:pointer;user-select:none;align-items:center;gap:6px;display:inline-flex}";
		const styleId$2 = "dsh-shadow-rewind/UnifiedDiff.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$2) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-shadow-rewind";
			style.dataset.pluginCss = styleId$2;
			style.textContent = css$2;
			document.head.appendChild(style);
		}
		var UnifiedDiff_module_css_default = {
			"unifiedAdded": "GmhTJW_unifiedAdded",
			"unifiedRemoved": "GmhTJW_unifiedRemoved",
			"unifiedHunkHeader": "GmhTJW_unifiedHunkHeader",
			"unifiedBody": "GmhTJW_unifiedBody",
			"unifiedNav": "GmhTJW_unifiedNav",
			"unifiedSign": "GmhTJW_unifiedSign",
			"unified_add": "GmhTJW_unified_add",
			"unified_del": "GmhTJW_unified_del",
			"unifiedOmitted": "GmhTJW_unifiedOmitted",
			"unifiedGap": "GmhTJW_unifiedGap",
			"unifiedLineNumber": "GmhTJW_unifiedLineNumber",
			"unifiedPath": "GmhTJW_unifiedPath",
			"unifiedLine": "GmhTJW_unifiedLine",
			"unifiedStatus": "GmhTJW_unifiedStatus",
			"unifiedHunkSelect": "GmhTJW_unifiedHunkSelect",
			"unifiedHighlight": "GmhTJW_unifiedHighlight",
			"unifiedHunkBar": "GmhTJW_unifiedHunkBar",
			"unifiedText": "GmhTJW_unifiedText",
			"unified_context": "GmhTJW_unified_context",
			"unifiedCopyButton": "GmhTJW_unifiedCopyButton",
			"unifiedFile": "GmhTJW_unifiedFile",
			"unifiedHeader": "GmhTJW_unifiedHeader",
			"unifiedEmbedded": "GmhTJW_unifiedEmbedded",
			"unifiedBlock": "GmhTJW_unifiedBlock"
		};
		//#endregion
		//#region src/client/UnifiedDiff.tsx
		/**
		* 统一的单栏 diff 视图内核 —— 轮尾卡片、live 条浮层、侧边栏三个面共用的
		* 渲染组件，也是「视图端 hunk 数学」的唯一实现。
		*
		* 设计要点：
		*  - **行数统计与渲染同源**：`summarizeDiffs` 用与渲染完全相同的行级 diff
		*    算法计 +/−，徽标数字和画出来的行永远一致；
		*  - **复制与所见即所得**：`unifiedDiffText` 直接复用同一套 `hunkLines`，
		*    复制出来的纯文本就是视图上那一段；
		*  - **渲染预算**：超过 `MAX_RENDER_LINES` 的行折叠成按钮，大 diff 不拖垮
		*    列表；
		*  - **块级选择 / 导航**：提供可选的 hunk 勾选（参与撤销子集）与 ↑/↓ 修改点
		*    跳转，选择由宿主组件经 `selectedHunks` 受控。
		*/
		/** 渲染行数上限：超出折叠为「显示其余」按钮（大 diff 的渲染防线）。 */
		const MAX_RENDER_LINES = 800;
		/** 把单个 hunk 的行级 diff 展开为带行号的渲染行序列。 */
		function hunkLines(diff) {
			const changes = diffArrays(diff.oldText === null ? [] : diffContentLines(diff.oldText), diffContentLines(diff.newText));
			const lines = [];
			let oldNumber = diff.oldStart ?? 1;
			let newNumber = diff.newStart ?? 1;
			const groups = [];
			for (const change of changes) {
				const start = lines.length;
				if (change.removed) {
					for (const text of change.value) {
						lines.push({
							kind: "del",
							oldNumber,
							newNumber: null,
							text
						});
						oldNumber++;
					}
					groups.push({
						kind: "del",
						start,
						count: change.value.length
					});
				} else if (change.added) {
					for (const text of change.value) {
						lines.push({
							kind: "add",
							oldNumber: null,
							newNumber,
							text
						});
						newNumber++;
					}
					groups.push({
						kind: "add",
						start,
						count: change.value.length
					});
				} else {
					for (const text of change.value) {
						lines.push({
							kind: "context",
							oldNumber,
							newNumber,
							text
						});
						oldNumber++;
						newNumber++;
					}
					groups.push({
						kind: "context",
						start,
						count: change.value.length
					});
				}
			}
			for (let i = 0; i < groups.length - 1; i++) {
				const del = groups[i];
				const add = groups[i + 1];
				if (del.kind !== "del" || add.kind !== "add" || del.count !== add.count) continue;
				for (let k = 0; k < del.count; k++) {
					const delLine = lines[del.start + k];
					const addLine = lines[add.start + k];
					const hl = lineHighlight(delLine.text, addLine.text);
					lines[del.start + k] = {
						...delLine,
						hl: hl.del
					};
					lines[add.start + k] = {
						...addLine,
						hl: hl.add
					};
				}
			}
			return lines;
		}
		/** 把一列行按上下文折叠：每段连续上下文只留头尾各 contextLines 行，中间折成 gap。 */
		function collapsedRows(lines, contextLines, hunkIndex) {
			const rows = [];
			let cursor = 0;
			let gapIndex = 0;
			while (cursor < lines.length) {
				const current = lines[cursor];
				if (current?.kind !== "context") {
					if (current !== void 0) rows.push(current);
					cursor++;
					continue;
				}
				const start = cursor;
				while (cursor < lines.length && lines[cursor]?.kind === "context") cursor++;
				const run = lines.slice(start, cursor);
				const leading = start === 0;
				const trailing = cursor === lines.length;
				const hiddenStart = leading ? 0 : Math.min(contextLines, run.length);
				const hiddenEnd = trailing ? run.length : Math.max(hiddenStart, run.length - contextLines);
				rows.push(...run.slice(0, hiddenStart));
				const hidden = run.slice(hiddenStart, hiddenEnd);
				if (hidden.length > 0) {
					rows.push({
						kind: "gap",
						id: `${hunkIndex}:${gapIndex}`,
						lines: hidden
					});
					gapIndex++;
				}
				rows.push(...run.slice(hiddenEnd));
			}
			return rows;
		}
		/** 把所有 hunk 展开为渲染单元，并按行锚点推算各 hunk 前被省略的上下文行数。 */
		function buildHunks(diffs, contextLines) {
			let previousPath;
			let previousOldEnd = 1;
			let previousNewEnd = 1;
			return diffs.map((diff, index) => {
				const lines = hunkLines(diff);
				const oldCount = lines.filter((line) => line.oldNumber !== null).length;
				const newCount = lines.filter((line) => line.newNumber !== null).length;
				const oldStart = diff.oldStart ?? 1;
				const newStart = diff.newStart ?? 1;
				const unchangedBefore = diff.oldStart !== void 0 && diff.newStart !== void 0 ? Math.max(0, Math.min(oldStart - (diff.path === previousPath ? previousOldEnd : 1), newStart - (diff.path === previousPath ? previousNewEnd : 1))) : 0;
				previousPath = diff.path;
				previousOldEnd = oldStart + oldCount;
				previousNewEnd = newStart + newCount;
				return {
					rows: collapsedRows(lines, contextLines, index),
					added: lines.filter((line) => line.kind === "add").length,
					removed: lines.filter((line) => line.kind === "del").length,
					unchangedBefore
				};
			});
		}
		/** 把录制的 hunks 序列化成一段纯文本 unified diff（复制按钮的输出）。 */
		function unifiedDiffText(diffs) {
			let previousPath;
			const output = [];
			for (const diff of diffs) {
				if (diff.path !== previousPath) output.push(diff.path);
				else output.push(`@@ -${diff.oldStart ?? 1} +${diff.newStart ?? 1} @@`);
				previousPath = diff.path;
				for (const line of hunkLines(diff)) {
					const prefix = line.kind === "del" ? "-" : line.kind === "add" ? "+" : " ";
					output.push(`${prefix} ${line.text}`);
				}
			}
			return output.join("\n");
		}
		/** 用与视图完全相同的行级 diff 算法统计增/删行数（与渲染零偏差）。 */
		function summarizeDiffs(diffs) {
			let added = 0;
			let removed = 0;
			for (const diff of diffs) for (const line of hunkLines(diff)) {
				if (line.kind === "add") added++;
				if (line.kind === "del") removed++;
			}
			return {
				added,
				removed
			};
		}
		/** 该行的两侧行号串（用于展开 gap 内行的稳定 key）。 */
		function lineNumbers(line) {
			return `${line.oldNumber === null ? "" : String(line.oldNumber)}, ${line.newNumber === null ? "" : String(line.newNumber)}`;
		}
		/** 该行显示在哪一侧的行号：删除行走旧号，其余行走新号。 */
		function lineNumber(line) {
			return line.kind === "del" ? line.oldNumber : line.newNumber;
		}
		/** 行文本渲染：带行内高亮区间时把变化字符段包进下划线 span（dsh-edit-diff 的字符级精度）。 */
		function renderLineText(line) {
			const ranges = line.hl;
			if (ranges === void 0 || ranges.length === 0) return line.text;
			const parts = [];
			let cursor = 0;
			for (let index = 0; index < ranges.length; index++) {
				const range = ranges[index];
				const start = range[0];
				const end = Math.min(range[1], line.text.length);
				if (start > cursor) parts.push(line.text.slice(cursor, start));
				if (end > start) parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: UnifiedDiff_module_css_default.unifiedHighlight,
					children: line.text.slice(start, end)
				}, index));
				cursor = Math.max(cursor, end);
			}
			if (cursor < line.text.length) parts.push(line.text.slice(cursor));
			return parts;
		}
		/**
		* 渲染带单一行号槽 + 可展开上下文 gap 的行对齐 hunks。
		* @param props - unified diff 数据、本地化标签与展示选项。
		* @returns 带行号的 unified diff 视图。
		*/
		function UnifiedDiff({ diffs, contextLines, labels, className, showCopyButton = true, showFileHeaders = true, selectable = false, selectedHunks, onSelectedHunksChange, navigation = false }) {
			const hunks = (0, react.useMemo)(() => buildHunks(diffs, contextLines), [contextLines, diffs]);
			const [expandedGaps, setExpandedGaps] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [copied, setCopied] = (0, react.useState)(false);
			const [showAllRows, setShowAllRows] = (0, react.useState)(false);
			const containerRef = (0, react.useRef)(null);
			const [navIndex, setNavIndex] = (0, react.useState)(0);
			const rendered = (0, react.useMemo)(() => {
				let budget = MAX_RENDER_LINES;
				let hiddenRows = 0;
				const blockKeys = [];
				const blockIndexByRow = /* @__PURE__ */ new Map();
				let blockCounter = -1;
				let prevChange = false;
				return {
					hunks: hunks.map((hunk, hunkIndex) => {
						const rows = [];
						for (const row of hunk.rows) {
							if (row.kind === "gap") {
								if (budget > 0) {
									rows.push(row);
									prevChange = false;
								} else hiddenRows++;
								continue;
							}
							if (budget <= 0) {
								hiddenRows++;
								continue;
							}
							budget -= 1;
							const isChange = row.kind !== "context";
							if (isChange) {
								if (!prevChange) {
									blockCounter += 1;
									blockKeys.push(`${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? "")}:${String(row.newNumber ?? "")}`);
								}
								blockIndexByRow.set(`${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? "")}:${String(row.newNumber ?? "")}`, blockCounter);
							}
							prevChange = isChange;
							rows.push(row);
						}
						return {
							...hunk,
							rows
						};
					}),
					blockKeys,
					blockIndexByRow,
					hiddenRows,
					truncated: hiddenRows > 0
				};
			}, [hunks]);
			(0, react.useEffect)(() => {
				setShowAllRows(false);
				setNavIndex(0);
			}, [diffs]);
			const scrollToBlock = (0, react.useCallback)((index) => {
				const root = containerRef.current;
				if (root === null) return;
				const key = rendered.blockKeys[index];
				if (key === void 0) return;
				root.querySelector(`[data-block="${key}"]`)?.scrollIntoView({ block: "center" });
				setNavIndex(index);
			}, [rendered.blockKeys]);
			(0, react.useEffect)(() => {
				if (navigation) scrollToBlock(0);
			}, [navigation]);
			const onCopy = (0, react.useCallback)(() => {
				if (copied) return;
				navigator.clipboard?.writeText(unifiedDiffText(diffs)).then(() => {
					setCopied(true);
					window.setTimeout(() => {
						setCopied(false);
					}, 1e3);
				}).catch(() => {});
			}, [copied, diffs]);
			if (diffs.length === 0) return null;
			const totals = /* @__PURE__ */ new Map();
			for (const [index, diff] of diffs.entries()) {
				const hunk = rendered.hunks[index];
				const previous = totals.get(diff.path) ?? {
					added: 0,
					removed: 0
				};
				totals.set(diff.path, {
					added: previous.added + (hunk?.added ?? 0),
					removed: previous.removed + (hunk?.removed ?? 0)
				});
			}
			let previousPath;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: containerRef,
				className: `${UnifiedDiff_module_css_default.unifiedBlock} ${showFileHeaders ? "" : UnifiedDiff_module_css_default.unifiedEmbedded} ${className ?? ""}`,
				"data-diff": "",
				"data-diff-layout": "unified",
				children: [
					showCopyButton && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: UnifiedDiff_module_css_default.unifiedCopyButton,
						onClick: onCopy,
						children: copied ? labels.copied : labels.copy
					}),
					navigation && rendered.blockKeys.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: UnifiedDiff_module_css_default.unifiedNav,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-label": "上一个修改点",
								disabled: navIndex <= 0,
								onClick: () => {
									scrollToBlock(navIndex - 1);
								},
								children: "↑"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								String(navIndex + 1),
								"/",
								String(rendered.blockKeys.length)
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-label": "下一个修改点",
								disabled: navIndex >= rendered.blockKeys.length - 1,
								onClick: () => {
									scrollToBlock(navIndex + 1);
								},
								children: "↓"
							})
						]
					}),
					diffs.map((diff, hunkIndex) => {
						const firstForPath = diff.path !== previousPath;
						previousPath = diff.path;
						const total = totals.get(diff.path) ?? {
							added: 0,
							removed: 0
						};
						const hunk = rendered.hunks[hunkIndex];
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: UnifiedDiff_module_css_default.unifiedFile,
							children: [
								selectable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: UnifiedDiff_module_css_default.unifiedHunkBar,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: UnifiedDiff_module_css_default.unifiedHunkSelect,
										title: labels.hunkInclude,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: selectedHunks === void 0 || selectedHunks.has(hunkIndex),
											onChange: (event) => {
												const next = new Set(selectedHunks ?? diffs.map((_, index) => index));
												if (event.target.checked) next.add(hunkIndex);
												else next.delete(hunkIndex);
												onSelectedHunksChange?.(next);
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: labels.hunkN(hunkIndex + 1) })]
									})
								}),
								showFileHeaders && firstForPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
									className: UnifiedDiff_module_css_default.unifiedHeader,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedStatus,
											children: "M"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: UnifiedDiff_module_css_default.unifiedPath,
											children: diff.path
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: UnifiedDiff_module_css_default.unifiedAdded,
											children: ["+", total.added]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: UnifiedDiff_module_css_default.unifiedRemoved,
											children: ["-", total.removed]
										})
									]
								}) : !firstForPath && (hunk?.unchangedBefore ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: UnifiedDiff_module_css_default.unifiedHunkHeader,
									children: [
										"@@ -",
										diff.oldStart ?? 1,
										" +",
										diff.newStart ?? 1,
										" @@"
									]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: UnifiedDiff_module_css_default.unifiedBody,
									children: [(hunk?.unchangedBefore ?? 0) > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: UnifiedDiff_module_css_default.unifiedOmitted,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											children: "↕"
										}), labels.showUnchanged(hunk?.unchangedBefore ?? 0)]
									}), (hunk?.rows ?? []).flatMap((row) => {
										if (row.kind !== "gap") {
											const sign = row.kind === "del" ? "-" : row.kind === "add" ? "+" : " ";
											const blockIndex = rendered.blockIndexByRow.get(`${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? "")}:${String(row.newNumber ?? "")}`);
											return [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: `${UnifiedDiff_module_css_default.unifiedLine} ${UnifiedDiff_module_css_default[`unified_${row.kind}`] ?? ""}`,
												"data-line-kind": row.kind,
												"data-old-line": row.oldNumber ?? void 0,
												"data-new-line": row.newNumber ?? void 0,
												"data-block": blockIndex === void 0 ? void 0 : `${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? "")}:${String(row.newNumber ?? "")}`,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: UnifiedDiff_module_css_default.unifiedLineNumber,
														children: lineNumber(row)
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: UnifiedDiff_module_css_default.unifiedSign,
														children: sign
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: UnifiedDiff_module_css_default.unifiedText,
														children: renderLineText(row)
													})
												]
											}, `${row.kind}:${row.oldNumber ?? ""}:${row.newNumber ?? ""}`)];
										}
										if (expandedGaps.has(row.id)) return [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: UnifiedDiff_module_css_default.unifiedGap,
											"aria-expanded": "true",
											onClick: () => {
												setExpandedGaps((current) => {
													const next = new Set(current);
													next.delete(row.id);
													return next;
												});
											},
											children: labels.hideUnchanged(row.lines.length)
										}, `${row.id}:control`), ...row.lines.map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: `${UnifiedDiff_module_css_default.unifiedLine} ${UnifiedDiff_module_css_default.unified_context}`,
											"data-line-kind": "context",
											"data-old-line": line.oldNumber ?? void 0,
											"data-new-line": line.newNumber ?? void 0,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: UnifiedDiff_module_css_default.unifiedLineNumber,
													children: lineNumber(line)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: UnifiedDiff_module_css_default.unifiedSign,
													children: " "
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: UnifiedDiff_module_css_default.unifiedText,
													children: line.text
												})
											]
										}, `${row.id}:${lineNumbers(line)}`))];
										return [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: UnifiedDiff_module_css_default.unifiedGap,
											"aria-expanded": "false",
											onClick: () => {
												setExpandedGaps((current) => /* @__PURE__ */ new Set([...current, row.id]));
											},
											children: labels.showUnchanged(row.lines.length)
										}, row.id)];
									})]
								})
							]
						}, `${diff.path}:${hunkIndex}`);
					}),
					rendered.truncated && !showAllRows && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: UnifiedDiff_module_css_default.unifiedGap,
						onClick: () => {
							setShowAllRows(true);
						},
						children: [
							"大 diff 已折叠：显示其余 ",
							String(rendered.hiddenRows),
							" 行"
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/subset-plan.ts
		/**
		* 对称模式（写入闸关闭）的恢复辅助：勾选路径 → 重新铸造一份只覆盖这些
		* 路径的恢复计划（planRestore 的 paths 过滤 + 全套安全闸原样保留），
		* 再由调用方用返回的 planId + confirmation 执行。两个恢复对话框共用。
		*/
		/** 服务端拒绝子集计划时的错误（code 用于区分 PLAN_STALE 等语义）。 */
		var SubsetPlanError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.code = code;
			}
		};
		/**
		* 按预览请求的相同定位参数（sessionId&turn / sessionId&messageSeq）重新
		* 铸造只覆盖 `paths` 的计划。失败抛 SubsetPlanError。
		*/
		async function fetchSubsetPlan(query, paths) {
			const url = `/shadow-rewind?${query}&details=1&paths=${encodeURIComponent(JSON.stringify(paths))}`;
			const response = await fetch(url, {
				headers: { accept: "application/json" },
				cache: "no-store"
			});
			const value = await response.json().catch(() => null);
			if (!response.ok) {
				const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
				throw new SubsetPlanError(typeof record.code === "string" ? record.code : "REWIND_FAILED", typeof record.error === "string" ? record.error : `HTTP ${String(response.status)}`);
			}
			const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
			if (typeof record.planId !== "string" || typeof record.confirmation !== "string") throw new SubsetPlanError("REWIND_FAILED", "恢复计划响应无效");
			return {
				planId: record.planId,
				confirmation: record.confirmation
			};
		}
		/** URL 长度守卫：勾选过多时拒绝发起（避免请求行超限）。 */
		function pathsTooLong(paths) {
			return JSON.stringify(paths).length > 6e3;
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* 侧边栏「文件审查」tab 的最小 zh / en 文案层。
		*
		* 走 DSH 的 i18n 体系：客户端 apply 通过 `attachLocale` 挂上语言服务
		* （`ctx.locale`，由 `@deepseek-ai/dsh-client-locale` 提供），`t()` 从它
		* 读取当前语言；没有挂载服务时（独立 / 测试装配）退回浏览器语言。整体沿用
		* dsh-better-sidebar 的 locales 模式。
		*
		* 与聊天面（`chat-locales.ts`）的键集来源相反：这一份以 `zh` 为真相来源。
		*/
		/** 本插件在 DSH 语言注册表里拥有的字典命名空间。 */
		const LOCALE_NS = "fileReviewTab";
		/** 中文字典（键集的唯一真相来源）。 */
		const zh$1 = {
			tabTitle: "文件审查",
			empty: "本会话暂无文件改动",
			sessionUnavailable: "会话不可用",
			remoteUnavailable: "文件审查服务不可用",
			turn: "第 {n} 轮",
			turnLive: "进行中",
			files: "{count} 个文件",
			filesOne: "1 个文件",
			undo: "撤销",
			redo: "重新应用",
			undoing: "正在撤销…",
			redoing: "正在重新应用…",
			undoTurn: "撤销本轮",
			redoTurn: "重新应用本轮",
			toggleUnavailable: "没有可安全还原的文件",
			stateUndone: "已撤销",
			stateConflict: "内容冲突",
			stateUnsupported: "不可还原",
			stateError: "错误",
			deleted: "已删除",
			deletedHint: "该文件在本轮中被终端命令删除，内容已不存在，无法查看差异或撤销。",
			dirBadge: "目录",
			dirHint: "这是一个空目录的增删记录，没有文件内容可展示；撤销/重新应用将重建或移除该目录。",
			undoSuccess: "已成功撤销更改",
			redoSuccess: "已成功重新应用更改",
			undoPartial: "部分文件未能撤销",
			redoPartial: "部分文件未能重新应用",
			toggleError: "操作失败",
			openInEditor: "在编辑器中打开",
			open: "打开 {name}",
			copy: "复制差异",
			copied: "已复制",
			showUnchanged: "显示 {count} 行未更改内容",
			hideUnchanged: "隐藏 {count} 行未更改内容",
			stats: "新增 {added} 行，删除 {removed} 行",
			unavailable: "无法为此更改还原可审查的差异。",
			refresh: "刷新状态",
			hunkN: "块 {n}",
			hunkInclude: "勾选：参与下一次撤销/重新应用；取消勾选：保留该块不动",
			hunkNoneSelected: "未选中任何改动块",
			snapshotRestore: "快照恢复",
			snapshotRestoreTitle: "把整个工作区恢复到这一轮开始之前（jj 影子快照）",
			snapshotDialogTitle: "从快照恢复此轮",
			snapshotDialogWarn: "整树恢复会把工作区全部文件恢复到第 {n} 轮开始之前，影响范围不止下面列出的文件；已记录的块级撤销状态可能随之失效（显示为冲突）。",
			snapshotLoading: "正在检查这一轮开始前的快照…",
			snapshotMissing: "没有找到这一轮开始前的快照：可能当时未启用自动快照、记录已清理，或该轮快照失败/跳过。",
			snapshotTotal: "将恢复 {count} 个文件",
			snapshotNoChanges: "工作区已经是这一轮开始前的状态，无需恢复。",
			snapshotBlocked: "这个项目目录还有别的对话正在运行。恢复文件会影响到它们，因此本次操作已被阻止。",
			snapshotGatedRunning: "另有 {n} 个会话正在运行；其文件写入已被写入闸拒绝，不会影响本次恢复。",
			gateOn: "闸：开",
			gateOff: "闸：关",
			gateUnknown: "闸：—",
			gateTitleOn: "当前为准模式（写入闸开启）：同一工作区只有「当前」会话可写，恢复为整树；点击切换到对称模式（重启后回到配置初值）",
			gateTitleOff: "对称模式（写入闸关闭）：所有会话都可并行写入，恢复时按归属勾选要还原的路径，运行中的会话会阻塞恢复；点击切换到当前为准模式（重启后回到配置初值）",
			gateToggleFailed: "切换写入闸失败",
			modeSymmetricHint: "对称模式：默认只勾选本会话改动的文件；勾选其它文件会把它们一并恢复到该时点。",
			ownerMulti: "双方都改过",
			ownerSession: "会话 {id}",
			ownerUnknown: "来源不明",
			attrAmbiguous: "本会话命令（哪条不确定）",
			attrExternal: "外部写入",
			turnOtherSessions: "含其它会话写入 {count}",
			multiConfirmTitle: "多会话写入冲突",
			multiConfirmWarn: "以下文件被多个会话交叉写入，继续操作会改动其它会话可能依赖的内容：",
			multiConfirmOthers: "本次提交还包含其它会话的写入：",
			multiConfirmManual: "改为手动勾选",
			multiConfirmProceedUndo: "继续撤销",
			multiConfirmProceedRedo: "继续应用",
			selectAll: "全部选中（整树恢复）",
			snapshotTotalSelected: "将恢复 {count} / {total} 个文件",
			pathsTooLong: "勾选的文件过多，无法构造恢复请求；请减少勾选",
			snapshotStale: "项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查。",
			snapshotSkipped: "以下文件未纳入快照，恢复不会改动它们：",
			snapshotRetry: "重新检查",
			snapshotApply: "恢复文件",
			snapshotApplying: "正在恢复…",
			snapshotDone: "项目文件已恢复到该轮开始之前；对话保持不变。恢复前的文件已自动备份。",
			snapshotFailed: "快照恢复失败",
			kindAdded: "移除后来新增的文件",
			kindDeleted: "找回文件",
			kindModified: "恢复之前的版本",
			kindModeChanged: "恢复文件权限",
			kindTypeChanged: "恢复之前的文件类型",
			skipTooLarge: "超过大小上限",
			skipUnsupportedType: "文件类型不支持",
			skipReadFailed: "读取失败",
			timeline: "时间线",
			timelineTitle: "修改时间线",
			timelineHint: "这是本会话中改动过这个文件的每一轮；点击行末的 +/− 统计可跳到那一轮的差异。",
			timelineEmpty: "本会话没有这个文件的改动记录",
			timelineNoDiff: "无差异文本",
			viewDiff: "查看第 {n} 轮的差异",
			close: "关闭",
			cancel: "取消"
		};
		/** 英文字典（`Record` 约束保证与中文键集一一对应，漏翻即编译报错）。 */
		const en$1 = {
			tabTitle: "File Review",
			empty: "No file changes in this session yet",
			sessionUnavailable: "Session is unavailable",
			remoteUnavailable: "File review service is unavailable",
			turn: "Turn {n}",
			turnLive: "in progress",
			files: "{count} files",
			filesOne: "1 file",
			undo: "Undo",
			redo: "Reapply",
			undoing: "Undoing…",
			redoing: "Reapplying…",
			undoTurn: "Undo turn",
			redoTurn: "Reapply turn",
			toggleUnavailable: "No safely reversible files are available",
			stateUndone: "undone",
			stateConflict: "conflict",
			stateUnsupported: "not reversible",
			stateError: "error",
			deleted: "deleted",
			deletedHint: "This file was deleted by a terminal command in this turn; its content is gone, so no diff or undo is available.",
			dirBadge: "directory",
			dirHint: "This is an empty-directory addition/removal record; there is no file content to show. Undo/reapply recreates or removes the directory.",
			undoSuccess: "Changes undone",
			redoSuccess: "Changes reapplied",
			undoPartial: "Some files could not be undone",
			redoPartial: "Some files could not be reapplied",
			toggleError: "Operation failed",
			openInEditor: "Open in editor",
			open: "Open {name}",
			copy: "Copy diff",
			copied: "Copied",
			showUnchanged: "{count} unchanged lines",
			hideUnchanged: "Hide {count} unchanged lines",
			stats: "{added} lines added, {removed} lines removed",
			unavailable: "No reconstructable diff is available for this change.",
			refresh: "Refresh status",
			hunkN: "Hunk {n}",
			hunkInclude: "Checked: included in the next undo/reapply; unchecked: this hunk is kept as-is",
			hunkNoneSelected: "No hunks selected",
			snapshotRestore: "Snapshot restore",
			snapshotRestoreTitle: "Restore the whole workspace to before this turn ran (jj shadow snapshot)",
			snapshotDialogTitle: "Restore turn from snapshot",
			snapshotDialogWarn: "A whole-tree restore reverts EVERY file in the workspace to its state before turn {n} — not just the files listed below. Recorded per-hunk undo states may show as conflicts afterwards.",
			snapshotLoading: "Checking the snapshot taken before this turn…",
			snapshotMissing: "No snapshot from before this turn was found: automatic checkpoints may have been disabled, pruned, or this turn's capture failed or was skipped.",
			snapshotTotal: "Will restore {count} files",
			snapshotNoChanges: "The workspace already matches the state before this turn; nothing to restore.",
			snapshotBlocked: "Another conversation is currently running in this project directory. Restoring would affect it, so this operation is blocked.",
			snapshotGatedRunning: "{n} more session(s) are running; their file writes are denied by the write gate and will not affect this restore.",
			gateOn: "Gate: on",
			gateOff: "Gate: off",
			gateUnknown: "Gate: —",
			gateTitleOn: "Current-wins mode (write gate on): only the current session may write in a workspace; restores revert the whole tree. Click to switch to symmetric mode (reverts to config on restart)",
			gateTitleOff: "Symmetric mode (write gate off): sessions write in parallel; restores let you pick paths by attribution, and running sessions block restores. Click to switch to current-wins mode (reverts to config on restart)",
			gateToggleFailed: "Failed to toggle the write gate",
			modeSymmetricHint: "Symmetric mode: only files changed by this session are checked by default; ticking other files restores them to this point as well.",
			ownerMulti: "changed by both",
			ownerSession: "session {id}",
			ownerUnknown: "unknown source",
			attrAmbiguous: "this session's command (which one is uncertain)",
			attrExternal: "written outside",
			turnOtherSessions: "{count} writes from other sessions",
			multiConfirmTitle: "Multi-session write conflict",
			multiConfirmWarn: "Multiple sessions wrote these files in overlapping ways. Proceeding will change content other sessions may rely on:",
			multiConfirmOthers: "This batch also includes writes from other sessions:",
			multiConfirmManual: "Choose manually",
			multiConfirmProceedUndo: "Undo anyway",
			multiConfirmProceedRedo: "Apply anyway",
			selectAll: "Select all (whole-tree restore)",
			snapshotTotalSelected: "Will restore {count} of {total} files",
			pathsTooLong: "Too many files selected to build the restore request; deselect some",
			snapshotStale: "The project files changed after the check. To avoid overwriting newer edits, recheck first.",
			snapshotSkipped: "These files were not captured in the snapshot; restoring will not touch them:",
			snapshotRetry: "Recheck",
			snapshotApply: "Restore files",
			snapshotApplying: "Restoring…",
			snapshotDone: "Project files were restored to the state before this turn; the conversation is unchanged. The previous state was backed up automatically.",
			snapshotFailed: "Snapshot restore failed",
			kindAdded: "remove files added later",
			kindDeleted: "recover the deleted file",
			kindModified: "restore the previous version",
			kindModeChanged: "restore file permissions",
			kindTypeChanged: "restore the previous file type",
			skipTooLarge: "over the size limit",
			skipUnsupportedType: "unsupported file type",
			skipReadFailed: "read failed",
			timeline: "Timeline",
			timelineTitle: "Change timeline",
			timelineHint: "Every turn in this session that touched this file; click a row's +/− stats to jump to that turn's diff.",
			timelineEmpty: "No changes to this file were recorded in this session",
			timelineNoDiff: "no diff text",
			viewDiff: "View the turn {n} diff",
			close: "Close",
			cancel: "Cancel"
		};
		/** 客户端 apply 挂进来的 DSH 语言服务（缺席时退回浏览器语言探测）。 */
		let localeService;
		/** 挂上（传 undefined 即摘下）DSH 语言服务。 */
		function attachLocale(service) {
			localeService = service;
		}
		/** 当前语言 id（'zh' | 'en'）：优先取语言服务快照，缺席时退回浏览器语言。 */
		function activeLocale() {
			return localeService?.getSnapshot().active ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "en";
		}
		/** 翻译一个文案键；`{name}` 占位符由 `params` 插值填充。 */
		function t(key, params) {
			let text = (activeLocale().toLowerCase().startsWith("zh") ? zh$1 : en$1)[key];
			if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
			return text;
		}
		//#endregion
		//#region \0dsh-shadow-rewind-css:D:\dsh-pulgn\dsh-shadow-rewind\src\client\FileReviewTab.module.css.mjs
		const css$1 = ".zOfc7q_root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);flex-direction:column;display:flex}.zOfc7q_header{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;align-items:center;gap:8px;min-height:36px;padding:0 10px;display:flex}.zOfc7q_headerTitle{font-weight:600}.zOfc7q_refreshButton{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;margin-left:auto;padding:2px 6px;font-size:13px;line-height:1}.zOfc7q_refreshButton:hover:not(:disabled){background:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}.zOfc7q_refreshButton:disabled{opacity:.5;cursor:default}.zOfc7q_notice{border-radius:8px;flex:none;margin:8px 10px 0;padding:6px 10px;font-size:12px}.zOfc7q_noticeSuccess{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent)}.zOfc7q_noticeError{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent)}.zOfc7q_body{flex:1;min-height:0;padding:8px 0 16px;overflow-y:auto}.zOfc7q_empty{color:var(--dsw-alias-label-tertiary);text-align:center;padding:24px 12px}.zOfc7q_turnGroup{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block);border-radius:10px;margin:0 8px 10px;overflow:hidden}.zOfc7q_turnHeader{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;min-height:34px;padding:0 8px 0 10px;display:flex}.zOfc7q_turnTitle{white-space:nowrap;font-weight:600}.zOfc7q_liveBadge{color:var(--dsw-alias-state-warning-primary,#d9a13b);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d9a13b) 14%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}.zOfc7q_turnCount{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.zOfc7q_stats{white-space:nowrap;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;display:inline-flex}.zOfc7q_added{color:var(--dsw-alias-state-success-primary)}.zOfc7q_removed{color:var(--dsw-alias-state-error-primary)}.zOfc7q_actionButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;align-items:center;gap:4px;margin-left:auto;padding:3px 8px;font-size:12px;display:inline-flex}.zOfc7q_actionButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-border-l1)}.zOfc7q_actionButton:disabled{opacity:.5;cursor:default}.zOfc7q_buttonIcon{fill:none;stroke:currentColor;stroke-width:1.6px;stroke-linecap:round;stroke-linejoin:round;width:13px;height:13px}.zOfc7q_fileList{margin:0;padding:0;list-style:none}.zOfc7q_fileItem+.zOfc7q_fileItem{border-top:1px solid var(--dsw-alias-border-l2)}.zOfc7q_fileRow{cursor:pointer;user-select:none;align-items:center;gap:6px;min-height:32px;padding:0 8px 0 6px;display:flex}.zOfc7q_fileRow:hover{background:color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent)}.zOfc7q_chevron{fill:none;width:12px;height:12px;stroke:var(--dsw-alias-label-tertiary);stroke-width:1.8px;stroke-linecap:round;stroke-linejoin:round;flex:none;transition:transform .12s}.zOfc7q_chevronOpen{transform:rotate(90deg)}.zOfc7q_fileName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow:hidden}.zOfc7q_stateBadge{white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}.zOfc7q_badgeUndone{color:var(--dsw-alias-state-warning-primary,#d9a13b);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d9a13b) 14%, transparent)}.zOfc7q_badgeMuted{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-border-l1)}.zOfc7q_badgeError{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}.zOfc7q_smallButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;flex:none;padding:2px 7px;font-size:11px}.zOfc7q_smallButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-border-l1)}.zOfc7q_smallButton:disabled{opacity:.5;cursor:default}.zOfc7q_fileRow .zOfc7q_smallButton:first-of-type{margin-left:auto}.zOfc7q_diffWrap{border-top:1px solid var(--dsw-alias-border-l2);overflow-x:auto}.zOfc7q_diffUnavailable{color:var(--dsw-alias-label-tertiary);margin:0;padding:10px 12px;font-size:12px}.zOfc7q_reviewDiff{border:0;border-radius:0;margin:0}.zOfc7q_deletedBadge{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}.zOfc7q_ownerBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-border-l1);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}.zOfc7q_statsButton{cursor:pointer;white-space:nowrap;background:0 0;border:0;border-radius:6px;flex:none;gap:6px;padding:2px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;display:inline-flex}.zOfc7q_statsButton:hover{background:var(--dsw-alias-border-l1)}.zOfc7q_timelinePath{color:var(--dsw-alias-label-tertiary);word-break:break-all;margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}.zOfc7q_timelineList{margin:0;padding:0;list-style:none}.zOfc7q_timelineItem{align-items:center;gap:8px;min-height:32px;padding:0 4px 0 20px;display:flex;position:relative}.zOfc7q_timelineItem:before{content:\"\";background:var(--dsw-alias-border-l2);width:1px;position:absolute;top:0;bottom:0;left:6px}.zOfc7q_timelineItem:first-child:before{top:50%}.zOfc7q_timelineItem:last-child:before{bottom:50%}.zOfc7q_timelineDot{background:var(--dsw-alias-border-l2);width:9px;height:9px;box-shadow:0 0 0 2px var(--dsw-alias-markdown-code-block);border-radius:50%;position:absolute;top:50%;left:2px;transform:translateY(-50%)}";
		const styleId$1 = "dsh-shadow-rewind/FileReviewTab.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId$1) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-shadow-rewind";
			style.dataset.pluginCss = styleId$1;
			style.textContent = css$1;
			document.head.appendChild(style);
		}
		var FileReviewTab_module_css_default = {
			"fileName": "zOfc7q_fileName",
			"timelineDot": "zOfc7q_timelineDot",
			"deletedBadge": "zOfc7q_deletedBadge",
			"headerTitle": "zOfc7q_headerTitle",
			"removed": "zOfc7q_removed",
			"root": "zOfc7q_root",
			"turnGroup": "zOfc7q_turnGroup",
			"actionButton": "zOfc7q_actionButton",
			"fileList": "zOfc7q_fileList",
			"badgeMuted": "zOfc7q_badgeMuted",
			"diffUnavailable": "zOfc7q_diffUnavailable",
			"refreshButton": "zOfc7q_refreshButton",
			"noticeSuccess": "zOfc7q_noticeSuccess",
			"reviewDiff": "zOfc7q_reviewDiff",
			"timelinePath": "zOfc7q_timelinePath",
			"added": "zOfc7q_added",
			"chevronOpen": "zOfc7q_chevronOpen",
			"stateBadge": "zOfc7q_stateBadge",
			"fileItem": "zOfc7q_fileItem",
			"statsButton": "zOfc7q_statsButton",
			"stats": "zOfc7q_stats",
			"chevron": "zOfc7q_chevron",
			"turnHeader": "zOfc7q_turnHeader",
			"body": "zOfc7q_body",
			"badgeUndone": "zOfc7q_badgeUndone",
			"header": "zOfc7q_header",
			"empty": "zOfc7q_empty",
			"badgeError": "zOfc7q_badgeError",
			"turnTitle": "zOfc7q_turnTitle",
			"ownerBadge": "zOfc7q_ownerBadge",
			"smallButton": "zOfc7q_smallButton",
			"timelineList": "zOfc7q_timelineList",
			"notice": "zOfc7q_notice",
			"timelineItem": "zOfc7q_timelineItem",
			"liveBadge": "zOfc7q_liveBadge",
			"noticeError": "zOfc7q_noticeError",
			"diffWrap": "zOfc7q_diffWrap",
			"turnCount": "zOfc7q_turnCount",
			"buttonIcon": "zOfc7q_buttonIcon",
			"fileRow": "zOfc7q_fileRow"
		};
		//#endregion
		//#region src/client/FileReviewTab.tsx
		/**
		* FileReviewTab —— better-sidebar tab 的本体：列出 agent 在**本会话**改过的
		* 每一个文件（按轮分组），行内渲染行级红/绿 diff，并经本包的宿主
		* file-review Typert remote 提供按轮 / 按文件的撤销 + 重新应用。全部推导都
		* 挂在客户端 runtime 的已定稿会话快照上——什么都不会注入聊天流（那正是本
		* 移植要消除的样式冲突源）。
		*/
		const SUCCESS_NOTICE_DURATION$1 = 3e3;
		const ERROR_NOTICE_DURATION$1 = 8e3;
		/** 一个 (轮, 文件) 变更组的状态映射键。 */
		function stateKey(turn, path) {
			return `${turn}|${path}`;
		}
		/** ms epoch → HH:MM（归因徽标的写入时间展示）。 */
		function formatClock(ms) {
			const date = new Date(ms);
			return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
		}
		/** fs 条目的归因徽标文案：开闸/旧宿主无归因（owner 缺省）→ 无徽标。
		* 命令级展示「命令 · 写入时间」；他会话展示会话标题；歧义/外部如实标注。 */
		function fsOwnerBadge(file, sessionTitle) {
			if (file.owner === void 0) return null;
			if (file.attribution === "command" && file.command !== void 0) return `${file.command.tool} · ${formatClock(file.writtenAt ?? file.command.startedAt)}`;
			if (file.owner === "multi") return t("ownerMulti");
			if (file.owner === "unknown") return t("ownerUnknown");
			if (file.owner !== "target") return sessionTitle(file.owner) ?? t("ownerSession", { id: file.owner.length > 12 ? `${file.owner.slice(0, 12)}…` : file.owner });
			if (file.attribution === "ambiguous") return t("attrAmbiguous");
			if (file.attribution === "external") return t("attrExternal");
			return null;
		}
		/** 一组变更只有在 hunks 完整可逆时才判定为可撤销。 */
		function isReversible(file) {
			if (file.diffs.length === 1) {
				const only = file.diffs[0];
				if (only !== void 0 && only.path === file.path) {
					if (only.oldText === null) return true;
					if (only.newText === "" && only.oldText !== "") return true;
				}
			}
			return file.diffs.length > 0 && file.diffs.every((diff) => diff.path === file.path && diff.oldText !== null && diff.oldText !== diff.newText && (diff.oldText !== "" || diff.oldStart !== void 0) && (diff.newText !== "" || diff.newStart !== void 0));
		}
		function addStats$1(left, right) {
			return {
				added: left.added + right.added,
				removed: left.removed + right.removed
			};
		}
		function Stats$1({ stats }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: FileReviewTab_module_css_default.stats,
				"aria-label": t("stats", {
					added: String(stats.added),
					removed: String(stats.removed)
				}),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: FileReviewTab_module_css_default.added,
					children: ["+", stats.added]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: FileReviewTab_module_css_default.removed,
					children: ["-", stats.removed]
				})]
			});
		}
		function UndoIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: FileReviewTab_module_css_default.buttonIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 5 4 9l4 4M4 9h7a5 5 0 0 1 5 5v1" })
			});
		}
		function RedoIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: FileReviewTab_module_css_default.buttonIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m12 5 4 4-4 4M16 9H9a5 5 0 0 0-5 5v1" })
			});
		}
		function Chevron({ open }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: `${FileReviewTab_module_css_default.chevron} ${open ? FileReviewTab_module_css_default.chevronOpen : ""}`,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m7 5 5 5-5 5" })
			});
		}
		/** 每个 (轮, 文件) 的宿主巡检状态徽标；'applied' 时不渲染任何东西。 */
		function StateBadge({ state }) {
			if (state === void 0 || state === "applied") return null;
			const label = state === "undone" ? t("stateUndone") : state === "conflict" ? t("stateConflict") : state === "unsupported" ? t("stateUnsupported") : t("stateError");
			const tone = state === "undone" ? FileReviewTab_module_css_default.badgeUndone : state === "unsupported" ? FileReviewTab_module_css_default.badgeMuted : FileReviewTab_module_css_default.badgeError;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `${FileReviewTab_module_css_default.stateBadge} ${tone}`,
				children: label
			});
		}
		/** 懒渲染：只有行接近视口时才挂载重的 diff 渲染器（200px 预读余量）。 */
		function LazyDiff({ children }) {
			const holderRef = (0, react.useRef)(null);
			const [inView, setInView] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (inView) return;
				const element = holderRef.current;
				if (element === null) return;
				if (typeof IntersectionObserver === "undefined") {
					setInView(true);
					return;
				}
				const observer = new IntersectionObserver((entries) => {
					if (entries.some((entry) => entry.isIntersecting)) {
						setInView(true);
						observer.disconnect();
					}
				}, { rootMargin: "200px 0px" });
				observer.observe(element);
				return () => {
					observer.disconnect();
				};
			}, [inView]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: holderRef,
				children: inView ? children : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: { minHeight: "96px" } })
			});
		}
		function decodeTurnPreview(value) {
			const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
			const status = record.status === "ready" || record.status === "pending" || record.status === "skipped" || record.status === "failed" || record.status === "missing" ? record.status : "missing";
			const changes = Array.isArray(record.changes) ? record.changes.map((entry) => {
				const item = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {};
				return {
					path: typeof item.path === "string" ? item.path : "",
					kind: typeof item.kind === "string" ? item.kind : "modified",
					...typeof item.owner === "string" ? { owner: item.owner } : {},
					...item.autoSelect === true ? { autoSelect: true } : {}
				};
			}).filter((change) => change.path !== "") : [];
			return {
				status,
				...typeof record.checkpointId === "string" ? { checkpointId: record.checkpointId } : {},
				...typeof record.planId === "string" ? { planId: record.planId } : {},
				...typeof record.confirmation === "string" ? { confirmation: record.confirmation } : {},
				...record.mode === "symmetric" || record.mode === "current-wins" ? { mode: record.mode } : {},
				...typeof record.reason === "string" ? { reason: record.reason } : {},
				...typeof record.error === "string" ? { error: record.error } : {},
				...typeof record.restoreBlocked === "boolean" ? { restoreBlocked: record.restoreBlocked } : {},
				...Array.isArray(record.gatedSessionIds) ? { gatedSessionIds: record.gatedSessionIds.filter((id) => typeof id === "string") } : {},
				totalChanges: typeof record.totalChanges === "number" ? record.totalChanges : changes.length,
				changes,
				truncated: record.truncated === true,
				...typeof record.offset === "number" ? { offset: record.offset } : {},
				activeSessionIds: Array.isArray(record.activeSessionIds) ? record.activeSessionIds.filter((id) => typeof id === "string") : [],
				skippedPaths: Array.isArray(record.skippedPaths) ? record.skippedPaths.map((entry) => {
					const item = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {};
					return {
						path: typeof item.path === "string" ? item.path : "",
						reason: typeof item.reason === "string" ? item.reason : ""
					};
				}).filter((skip) => skip.path !== "") : [],
				...typeof record.nextCheckpointId === "string" ? { nextCheckpointId: record.nextCheckpointId } : {},
				...Array.isArray(record.fileSystemChanges) ? { fileSystemChanges: record.fileSystemChanges.map((entry) => {
					const item = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {};
					const path = typeof item.path === "string" ? item.path : "";
					const rawKind = typeof item.kind === "string" ? item.kind : "modified";
					return {
						path,
						kind: rawKind === "added" || rawKind === "modified" || rawKind === "deleted" ? rawKind : "modified"
					};
				}).filter((change) => change.path !== "") } : {}
			};
		}
		/** 快照跳过原因的用户文案。 */
		function skipReasonLabel$1(reason) {
			if (reason === "too-large") return t("skipTooLarge");
			if (reason === "unsupported-type") return t("skipUnsupportedType");
			if (reason === "read-failed") return t("skipReadFailed");
			return reason;
		}
		/** 快照差异类别的用户文案（与回退对话框的 kindLabel 语义一致）。 */
		function snapshotKindLabel(kind) {
			switch (kind) {
				case "added": return t("kindAdded");
				case "deleted": return t("kindDeleted");
				case "modified": return t("kindModified");
				case "mode-changed": return t("kindModeChanged");
				case "type-changed": return t("kindTypeChanged");
				default: return kind;
			}
		}
		function TurnRewindDialog({ sessionId, turn, windowStats, onJumpToDiff, sessionTitle, onClose, onRestored }) {
			const [loading, setLoading] = (0, react.useState)(true);
			const [preview, setPreview] = (0, react.useState)(null);
			const [applying, setApplying] = (0, react.useState)(false);
			const [stale, setStale] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [done, setDone] = (0, react.useState)(false);
			const [selected, setSelected] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async (silent = false) => {
				if (!silent) {
					setLoading(true);
					setStale(false);
					setError(null);
					setDone(false);
				}
				try {
					const response = await fetch(`/shadow-rewind?sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}`, {
						headers: { accept: "application/json" },
						cache: "no-store"
					});
					const value = await response.json();
					if (!response.ok) {
						const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
						if (record.code === "RESTORE_POINT_NOT_FOUND") {
							setPreview(null);
							setError(t("snapshotMissing"));
							return;
						}
						throw new Error(typeof record.error === "string" ? record.error : `HTTP ${String(response.status)}`);
					}
					const first = decodeTurnPreview(value);
					if (first.status === "ready" && first.mode === "symmetric" && first.truncated) {
						const collected = [...first.changes];
						let offset = collected.length;
						while (first.totalChanges > offset) {
							const pageResponse = await fetch(`/shadow-rewind?sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}&details=1&offset=${String(offset)}&limit=200`, {
								headers: { accept: "application/json" },
								cache: "no-store"
							});
							const pageValue = await pageResponse.json();
							if (!pageResponse.ok) {
								const pageRecord = typeof pageValue === "object" && pageValue !== null && !Array.isArray(pageValue) ? pageValue : {};
								throw new Error(typeof pageRecord.error === "string" ? pageRecord.error : `HTTP ${String(pageResponse.status)}`);
							}
							const page = decodeTurnPreview(pageValue);
							if (page.status !== "ready" || page.checkpointId !== first.checkpointId || page.offset !== offset) throw new Error(t("snapshotStale"));
							collected.push(...page.changes);
							offset += page.changes.length;
							if (page.changes.length === 0) break;
						}
						const merged = {
							...first,
							changes: collected,
							truncated: false
						};
						setPreview(merged);
						setSelected(new Set(merged.changes.filter((change) => change.autoSelect === true).map((change) => change.path)));
						return;
					}
					setPreview(first);
					setSelected(first.status === "ready" && first.mode === "symmetric" ? new Set(first.changes.filter((change) => change.autoSelect === true).map((change) => change.path)) : null);
				} catch (caught) {
					if (!silent) setError(`${t("snapshotFailed")}: ${caught instanceof Error ? caught.message : String(caught)}`);
				} finally {
					if (!silent) setLoading(false);
				}
			}, [sessionId, turn]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const ready = preview !== null && preview.status === "ready" ? preview : null;
			const blocked = ready !== null && (ready.restoreBlocked ?? ready.activeSessionIds.length > 0);
			(0, react.useEffect)(() => {
				if (!blocked || done || applying) return;
				const timer = window.setInterval(() => {
					load(true);
				}, 3e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [
				blocked,
				done,
				applying,
				load
			]);
			const gatedRunning = ready?.gatedSessionIds?.length ?? 0;
			const symmetric = ready?.mode === "symmetric";
			const selectedCount = selected?.size ?? 0;
			const allSelected = symmetric && ready !== null && selected !== null && selected.size >= ready.changes.length && ready.changes.length > 0;
			const togglePath = (0, react.useCallback)((path) => {
				setSelected((current) => {
					if (current === null) return current;
					const next = new Set(current);
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
			}, []);
			const setAllPaths = (0, react.useCallback)((selectAll) => {
				setSelected((current) => {
					if (current === null) return current;
					if (!selectAll) return /* @__PURE__ */ new Set();
					const readyNow = preview !== null && preview.status === "ready" ? preview : null;
					return readyNow === null ? current : new Set(readyNow.changes.map((change) => change.path));
				});
			}, [preview]);
			const canApply = ready !== null && !loading && !applying && !done && !stale && !blocked && ready.totalChanges > 0 && (!symmetric || selectedCount > 0) && ready.checkpointId !== void 0 && ready.planId !== void 0 && ready.confirmation !== void 0;
			const apply = (0, react.useCallback)(async () => {
				if (ready === null || !canApply) return;
				if (ready.checkpointId === void 0 || ready.planId === void 0 || ready.confirmation === void 0) return;
				setApplying(true);
				setError(null);
				try {
					let planId = ready.planId;
					let confirmation = ready.confirmation;
					if (selected !== null && selected.size < ready.totalChanges) {
						const paths = ready.changes.filter((change) => selected.has(change.path)).map((change) => change.path);
						if (paths.length === 0) return;
						if (pathsTooLong(paths)) throw new Error(t("pathsTooLong"));
						const subset = await fetchSubsetPlan(`sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}`, paths);
						planId = subset.planId;
						confirmation = subset.confirmation;
					}
					const response = await fetch("/shadow-rewind", {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						body: JSON.stringify({
							mode: "code",
							sessionId,
							turn,
							checkpointId: ready.checkpointId,
							planId,
							confirmation
						})
					});
					const value = await response.json();
					if (!response.ok) {
						const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
						if (record.code === "PLAN_STALE" || record.code === "WORKSPACE_IN_USE") setStale(true);
						throw new Error(typeof record.error === "string" ? record.error : `HTTP ${String(response.status)}`);
					}
					setDone(true);
					onRestored();
				} catch (caught) {
					setError(`${t("snapshotFailed")}: ${caught instanceof Error ? caught.message : String(caught)}`);
				} finally {
					setApplying(false);
				}
			}, [
				ready,
				canApply,
				selected,
				sessionId,
				turn,
				onRestored
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "srw-overlay",
				role: "dialog",
				"aria-modal": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "srw-dialog",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "srw-dialog-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("snapshotDialogTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "srw-trigger",
								onClick: onClose,
								"aria-label": t("close"),
								children: "✕"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "srw-content",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "srw-body",
								children: [
									loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "srw-status",
										children: t("snapshotLoading")
									}),
									preview?.status === "pending" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "srw-status",
										children: t("snapshotLoading")
									}),
									(preview?.status === "missing" || preview?.status === "skipped") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "srw-error",
										children: t("snapshotMissing")
									}),
									preview?.status === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: "srw-error",
										children: [
											t("snapshotFailed"),
											": ",
											preview.error ?? preview.reason ?? ""
										]
									}),
									ready !== null && [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "srw-warning",
											children: t("snapshotDialogWarn", { n: turn })
										}, "warn"),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "srw-summary",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: symmetric ? t("snapshotTotalSelected", {
												count: selectedCount,
												total: ready.totalChanges
											}) : t("snapshotTotal", { count: ready.totalChanges }) })
										}, "summary"),
										symmetric && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "srw-status",
											children: t("modeSymmetricHint")
										}, "hint"),
										blocked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "srw-error",
											children: t("snapshotBlocked")
										}, "blocked"),
										gatedRunning > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "srw-warning",
											children: t("snapshotGatedRunning", { n: gatedRunning })
										}, "gated"),
										ready.skippedPaths.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "srw-skipped",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("snapshotSkipped") }), ready.skippedPaths.map((skip) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: skip.path }),
												"（",
												skipReasonLabel$1(skip.reason),
												"）"
											] }, skip.path))]
										}, "skipped"),
										stale && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "srw-error",
											children: t("snapshotStale")
										}, "stale"),
										ready.totalChanges === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "srw-status",
											children: t("snapshotNoChanges")
										}, "nochanges"),
										ready.changes.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "srw-files",
											children: [symmetric && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: "srw-select-all",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: allSelected,
													onChange: (event) => {
														setAllPaths(event.target.checked);
													}
												}), t("selectAll")]
											}, "selectall"), ready.changes.map((change) => {
												const badge = change.owner === void 0 || change.owner === "target" ? null : change.owner === "multi" ? t("ownerMulti") : change.owner === "unknown" ? t("ownerUnknown") : sessionTitle(change.owner) ?? t("ownerSession", { id: change.owner.length > 12 ? `${change.owner.slice(0, 12)}…` : change.owner });
												const windowEntry = windowStats.get(change.path);
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "srw-file",
													children: [
														symmetric && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "checkbox",
															checked: selected?.has(change.path) ?? false,
															onChange: () => {
																togglePath(change.path);
															}
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: change.path }),
														badge !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "srw-kind",
															children: badge
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "srw-kind",
															children: snapshotKindLabel(change.kind)
														}),
														windowEntry !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: FileReviewTab_module_css_default.statsButton,
															title: t("viewDiff", { n: windowEntry.latestTurn }),
															onClick: (event) => {
																event.stopPropagation();
																onJumpToDiff(windowEntry.latestTurn, change.path);
															},
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats: windowEntry.stats })
														})
													]
												}, change.path);
											})]
										}, "files")
									],
									done && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "srw-status",
										children: t("snapshotDone")
									}),
									error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "srw-error",
										children: error
									}),
									!loading && (ready === null || stale || blocked) && !done && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "srw-retry",
										onClick: () => {
											load();
										},
										children: t("snapshotRetry")
									})
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "srw-foot",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: onClose,
								disabled: applying,
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									apply();
								},
								disabled: !canApply,
								children: applying ? t("snapshotApplying") : done ? t("close") : t("snapshotApply")
							})]
						})
					]
				})
			});
		}
		/** 骨架复刻 TurnRewindDialog 的 srw-* 样式；纯同步确认，无 fetch 状态机。 */
		function MultiSessionConfirmDialog({ items, action, sessionTitle, onCancel, onManual, onProceed }) {
			const conflicts = items.filter((item) => item.owner === "multi");
			const others = items.filter((item) => item.owner !== void 0 && item.owner !== "target" && item.owner !== "multi" && item.owner !== "unknown");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "srw-overlay",
				role: "dialog",
				"aria-modal": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "srw-dialog",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "srw-dialog-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("multiConfirmTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "srw-trigger",
								onClick: onCancel,
								"aria-label": t("close"),
								children: "✕"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "srw-content",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "srw-body",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "srw-warning",
										children: t("multiConfirmWarn")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "srw-files",
										children: conflicts.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "srw-file",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.path }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "srw-kind",
												children: t("ownerMulti")
											})]
										}, stateKey(item.turn, item.path)))
									}),
									others.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: "srw-status",
										children: [t("multiConfirmOthers"), others.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [index > 0 ? "、" : " ", sessionTitle(item.owner) ?? item.owner] }, stateKey(item.turn, item.path)))]
									})
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "srw-foot",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: onCancel,
									children: t("cancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: onManual,
									children: t("multiConfirmManual")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: onProceed,
									children: t(action === "undo" ? "multiConfirmProceedUndo" : "multiConfirmProceedRedo")
								})
							]
						})
					]
				})
			});
		}
		function FileTimelineDialog({ path, entries, onPick, onClose }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "srw-overlay",
				role: "dialog",
				"aria-modal": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "srw-dialog",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "srw-dialog-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("timelineTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "srw-trigger",
								onClick: onClose,
								"aria-label": t("close"),
								children: "✕"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "srw-content",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "srw-body",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: FileReviewTab_module_css_default.timelinePath,
									children: path
								}), entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "srw-status",
									children: t("timelineEmpty")
								}) : [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "srw-status",
									children: t("timelineHint")
								}, "hint"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: FileReviewTab_module_css_default.timelineList,
									children: [...entries].reverse().map((entry) => {
										const stats = entry.counts ?? summarizeDiffs(entry.diffs);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											className: FileReviewTab_module_css_default.timelineItem,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: FileReviewTab_module_css_default.timelineDot,
													"aria-hidden": "true"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: FileReviewTab_module_css_default.turnTitle,
													children: t("turn", { n: entry.turn })
												}),
												entry.live && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: FileReviewTab_module_css_default.liveBadge,
													children: t("turnLive")
												}),
												entry.deleted === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: FileReviewTab_module_css_default.deletedBadge,
													children: t("deleted")
												}),
												entry.diffs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: FileReviewTab_module_css_default.turnCount,
													children: t("timelineNoDiff")
												}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: FileReviewTab_module_css_default.statsButton,
													title: t("viewDiff", { n: entry.turn }),
													onClick: () => {
														onPick(entry.turn);
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats })
												})
											]
										}, entry.turn);
									})
								}, "list")]]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "srw-foot",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: onClose,
								children: t("close")
							})
						})
					]
				})
			});
		}
		/** 侧边栏 tab 本体：逐轮变更组 + 行内 diff + 撤销。 */
		function FileReviewTab({ ctx, sessionId, cwd, visible, tab }) {
			const sessions = ctx.sessions;
			const [states, setStates] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const [statusPending, setStatusPending] = (0, react.useState)(false);
			const [busyKey, setBusyKey] = (0, react.useState)(null);
			const [expanded, setExpanded] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [notice, setNotice] = (0, react.useState)(null);
			const [tick, setTick] = (0, react.useState)(0);
			const [hunkSelection, setHunkSelection] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const [rewindTurn, setRewindTurn] = (0, react.useState)(null);
			const [timelinePath, setTimelinePath] = (0, react.useState)(null);
			const [pendingConfirm, setPendingConfirm] = (0, react.useState)(null);
			const noticeSeqRef = (0, react.useRef)(0);
			const noticeTimerRef = (0, react.useRef)(null);
			const uiConversation = ctx.uiConversation;
			const chatSource = (0, react.useMemo)(() => uiConversation?.binding(sessionId).target("chat"), [uiConversation, sessionId]);
			const subscribe = (0, react.useCallback)((listener) => chatSource?.subscribe(listener) ?? (() => {}), [chatSource]);
			const snapshot = (0, react.useSyncExternalStore)(subscribe, () => chatSource?.getSnapshot() ?? null);
			const sessionList = (0, react.useSyncExternalStore)((0, react.useCallback)((listener) => sessions.list.subscribe(listener), [sessions]), () => sessions.list.getSnapshot());
			const sessionTitle = (0, react.useCallback)((id) => sessionList.byId[id]?.displayTitle, [sessionList]);
			const roots = (0, react.useMemo)(() => snapshot === null ? [] : deriveSessionRoots(snapshot), [snapshot]);
			const rootsKey = (0, react.useMemo)(() => roots.map((root) => root.rootCallId).join("|"), [roots]);
			const [recorded, setRecorded] = (0, react.useState)(() => []);
			const [fsRaw, setFsRaw] = (0, react.useState)([]);
			const [ensuredFs, setEnsuredFs] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const fsRawRef = (0, react.useRef)(fsRaw);
			fsRawRef.current = fsRaw;
			const ensuredFsRef = (0, react.useRef)(ensuredFs);
			ensuredFsRef.current = ensuredFs;
			(0, react.useEffect)(() => {
				if (!visible || cwd === void 0 || cwd.trim() === "") {
					setFsRaw([]);
					return;
				}
				let active = true;
				fetchAllFsChanges(sessionId).then((payload) => {
					if (!active) return;
					setFsRaw(payload.turns);
				}).catch(() => {
					if (!active) return;
					setFsRaw([]);
				});
				return () => {
					active = false;
				};
			}, [
				visible,
				tick,
				sessionId,
				cwd
			]);
			/** 按需补齐 fs 条目全文（展开 diff、撤销提交、恢复窗口统计共用）。 */
			const ensureFsTurnFiles = (0, react.useCallback)(async (turn, paths) => {
				if (cwd === void 0) return;
				const fsTurn = fsRawRef.current.find((entry) => entry.turn === turn);
				if (fsTurn === void 0) return;
				const wanted = fsTurn.changes.filter((change) => (paths === void 0 || paths.includes(change.path)) && !ensuredFsRef.current.has(`${String(turn)}|${change.path}`));
				if (wanted.length === 0) return;
				const settled = await Promise.all(wanted.map(async (change) => [`${String(turn)}|${change.path}`, await ensureFsFileDiff(fsTurn, change.path, cwd)]));
				setEnsuredFs((current) => {
					const next = new Map(current);
					for (const [key, value] of settled) if (value !== null) next.set(key, value);
					return next;
				});
				setHunkSelection((current) => {
					let changed = false;
					const next = new Map(current);
					for (const [key, value] of settled) {
						if (value === null || value.autoSelect !== false || next.has(key)) continue;
						next.set(key, /* @__PURE__ */ new Set());
						changed = true;
					}
					return changed ? next : current;
				});
			}, [cwd]);
			const fsTurns = (0, react.useMemo)(() => {
				const result = [];
				for (const fsTurn of fsRaw) {
					const files = [];
					for (const change of fsTurn.changes) {
						const ensured = ensuredFs.get(`${String(fsTurn.turn)}|${change.path}`);
						if (ensured !== void 0) {
							files.push(ensured);
							continue;
						}
						files.push({
							path: change.path,
							diffs: [],
							origin: "fs",
							...change.dir === true ? { dir: true } : {},
							...change.added !== void 0 || change.removed !== void 0 ? { counts: {
								added: change.added ?? 0,
								removed: change.removed ?? 0
							} } : {},
							...change.kind === "deleted" ? { deleted: true } : {},
							...fsAttributionOf(change)
						});
					}
					if (files.length > 0) result.push({
						turn: fsTurn.turn,
						live: false,
						files
					});
				}
				return result;
			}, [fsRaw, ensuredFs]);
			(0, react.useEffect)(() => {
				if (!visible || roots.length === 0) return;
				let active = true;
				const timer = window.setTimeout(() => {
					const scope = sessions.scope(sessionId);
					const remote = scope?.remote.fileReview;
					if (scope === void 0 || remote === void 0) {
						active = false;
						return;
					}
					remote.recorded({ rootCallIds: roots.map((root) => root.rootCallId) }).then((result) => {
						if (!result.ok || !active) return;
						setRecorded(result.value.mutations);
					}).catch(() => {});
				}, 200);
				return () => {
					active = false;
					window.clearTimeout(timer);
				};
			}, [
				visible,
				rootsKey,
				tick,
				sessions,
				sessionId
			]);
			const turns = (0, react.useMemo)(() => {
				const base = mergeRecordedTurns(deriveSessionChanges(snapshot), roots, recorded);
				if (fsTurns.length === 0) return base;
				const byTurn = /* @__PURE__ */ new Map();
				for (const turn of base) byTurn.set(turn.turn, turn);
				for (const fsTurn of fsTurns) {
					const existing = byTurn.get(fsTurn.turn);
					if (existing === void 0) {
						byTurn.set(fsTurn.turn, fsTurn);
						continue;
					}
					const files = [...existing.files];
					for (const fsFile of fsTurn.files) if (files.findIndex((f) => f.path === fsFile.path) === -1) files.push(fsFile);
					byTurn.set(fsTurn.turn, {
						turn: existing.turn,
						live: existing.live,
						files
					});
				}
				return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
			}, [
				snapshot,
				roots,
				recorded,
				fsTurns
			]);
			const flat = (0, react.useMemo)(() => turns.flatMap((turn) => turn.files.map((file) => ({
				turn: turn.turn,
				path: file.path,
				diffs: file.diffs,
				...file.deleted === true ? { deleted: true } : {},
				...file.origin !== void 0 ? { origin: file.origin } : {},
				...file.counts !== void 0 ? { counts: file.counts } : {},
				...fsAttributionOf(file)
			}))), [turns]);
			const inspectable = (0, react.useMemo)(() => flat.filter((item) => (item.deleted !== true || item.diffs.length > 0) && !(item.origin === "fs" && item.diffs.length === 0)), [flat]);
			const flatKey = (0, react.useMemo)(() => flat.map((item) => `${item.turn}|${item.path}|${item.diffs.length}`).join(";"), [flat]);
			const flatRef = (0, react.useRef)(flat);
			flatRef.current = flat;
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const turnRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const bodyRef = (0, react.useRef)(null);
			const lastMetaRef = (0, react.useRef)(void 0);
			const pendingScrollRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const meta = tab.meta;
				if (meta === lastMetaRef.current) return;
				lastMetaRef.current = meta;
				if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return;
				const raw = meta.expandPaths;
				if (!Array.isArray(raw)) return;
				const paths = raw.filter((value) => typeof value === "string");
				if (paths.length === 0) return;
				const turnNo = meta.turn;
				const targetTurn = typeof turnNo === "number" && Number.isInteger(turnNo) ? turnNo : void 0;
				const matches = (item) => paths.includes(item.path) && (targetTurn === void 0 || item.turn === targetTurn);
				setExpanded((current) => {
					const next = new Set(current);
					for (const item of flatRef.current) if (matches(item)) next.add(stateKey(item.turn, item.path));
					return next;
				});
				const first = flatRef.current.find((item) => matches(item));
				pendingScrollRef.current = first === void 0 ? null : {
					rowKey: stateKey(first.turn, first.path),
					turn: paths.length > 1 ? first.turn : null
				};
			}, [tab.meta]);
			(0, react.useEffect)(() => {
				if (!visible) return;
				const pending = pendingScrollRef.current;
				if (pending === null) return;
				const element = (pending.turn !== null ? turnRefs.current.get(pending.turn) : void 0) ?? rowRefs.current.get(pending.rowKey);
				if (element === void 0) return;
				pendingScrollRef.current = null;
				const scroll = () => {
					const container = bodyRef.current;
					if (container === null) return;
					const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
					container.scrollTo({
						top: container.scrollTop + delta - 8,
						behavior: "smooth"
					});
				};
				scroll();
				const timer = window.setTimeout(scroll, 150);
				return () => window.clearTimeout(timer);
			}, [
				visible,
				expanded,
				tab.meta,
				flatKey
			]);
			const showNotice = (0, react.useCallback)((tone, text) => {
				noticeSeqRef.current += 1;
				const seq = noticeSeqRef.current;
				if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
				noticeTimerRef.current = window.setTimeout(() => {
					setNotice((current) => current?.seq === seq ? null : current);
				}, tone === "success" ? SUCCESS_NOTICE_DURATION$1 : ERROR_NOTICE_DURATION$1);
				setNotice({
					seq,
					tone,
					text
				});
			}, []);
			(0, react.useEffect)(() => () => {
				if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
			}, []);
			const [gateOn, setGateOn] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let active = true;
				fetch("/shadow-rewind/gate", {
					headers: { accept: "application/json" },
					cache: "no-store"
				}).then((response) => response.json()).then((value) => {
					if (!active) return;
					const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
					if (typeof record.enabled === "boolean") setGateOn(record.enabled);
				}).catch(() => {});
				return () => {
					active = false;
				};
			}, []);
			const toggleGate = (0, react.useCallback)(() => {
				fetch("/shadow-rewind/gate", {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json"
					},
					body: JSON.stringify({ enabled: !(gateOn ?? true) })
				}).then((response) => {
					if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
					return response.json();
				}).then((value) => {
					const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
					if (typeof record.enabled !== "boolean") throw new Error("invalid response");
					setGateOn(record.enabled);
					showNotice("success", record.enabled ? t("gateTitleOn") : t("gateTitleOff"));
				}).catch((error) => {
					showNotice("error", `${t("gateToggleFailed")}: ${error instanceof Error ? error.message : String(error)}`);
				});
			}, [gateOn, showNotice]);
			const invoke = (0, react.useCallback)(async (method, request) => {
				const scope = sessions.scope(sessionId);
				if (scope === void 0) throw new Error(t("sessionUnavailable"));
				const remote = scope.remote.fileReview;
				if (remote === void 0) throw new Error(t("remoteUnavailable"));
				const result = await remote[method](request);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			}, [sessions, sessionId]);
			(0, react.useEffect)(() => {
				if (!visible || flat.length === 0) return;
				let active = true;
				setStatusPending(true);
				const timer = window.setTimeout(() => {
					const request = {
						action: "undo",
						files: inspectable.map((item) => ({
							path: item.path,
							diffs: item.diffs
						}))
					};
					invoke("status", request).then((result) => {
						if (!active) return;
						setStates(() => {
							const next = /* @__PURE__ */ new Map();
							inspectable.forEach((item, index) => {
								const file = result.files[index];
								if (file !== void 0) next.set(stateKey(item.turn, item.path), file.state);
							});
							return next;
						});
					}).catch(() => {}).finally(() => {
						if (active) setStatusPending(false);
					});
				}, 300);
				return () => {
					active = false;
					window.clearTimeout(timer);
				};
			}, [
				visible,
				flatKey,
				tick,
				invoke
			]);
			const mergeResultStates = (0, react.useCallback)((items, result) => {
				setStates((current) => {
					const next = new Map(current);
					items.forEach((item, index) => {
						const file = result.files[index];
						if (file !== void 0) next.set(stateKey(item.turn, item.path), file.state);
					});
					return next;
				});
			}, []);
			/** Toggle one change set (a whole turn, or one file) undo ↔ redo — 提交闸
			* 单点：轮/文件按钮都传全文，筛选在此统一完成。
			* ① autoSelect === false 的条目（其它会话/歧义写入）须有显式勾选才纳入；
			* ② 批次含 owner === 'multi'（真多会话冲突）⇒ 先弹确认窗，确认后走
			* applyToggle；其余批次直接提交。 */
			const applyToggle = (0, react.useCallback)((key, items, action) => {
				if (busyKey !== null || items.length === 0) return;
				setBusyKey(key);
				let submitted = [];
				(async () => {
					const ensuredItems = [];
					for (const item of items) {
						if (item.diffs.length > 0 || item.origin !== "fs") {
							ensuredItems.push(item);
							continue;
						}
						await ensureFsTurnFiles(item.turn, [item.path]);
						const ensured = ensuredFsRef.current.get(`${String(item.turn)}|${item.path}`);
						if (ensured !== void 0) ensuredItems.push({
							...item,
							diffs: ensured.diffs,
							...ensured.deleted === true ? { deleted: true } : {}
						});
					}
					submitted = ensuredItems.flatMap((item) => {
						if (item.diffs.length === 0) return [];
						const selection = hunkSelection.get(stateKey(item.turn, item.path));
						if (selection === void 0 || selection.size >= item.diffs.length) return [item];
						const subset = item.diffs.filter((_, index) => selection.has(index));
						return subset.length > 0 ? [{
							...item,
							diffs: subset
						}] : [];
					});
					if (submitted.length === 0) return void 0;
					return invoke("apply", {
						action,
						files: submitted.map((item) => ({
							path: item.path,
							diffs: item.diffs,
							...item.origin !== void 0 ? { origin: item.origin } : {},
							...item.dir === true ? { dirKind: item.deleted === true ? "deleted" : "added" } : {}
						}))
					});
				})().then((result) => {
					if (result === void 0) return;
					mergeResultStates(submitted, result);
					const target = action === "undo" ? "undone" : "applied";
					if (result.files.filter((file) => file.state !== target).length === 0) showNotice("success", t(action === "undo" ? "undoSuccess" : "redoSuccess"));
					else showNotice("error", t(action === "undo" ? "undoPartial" : "redoPartial"));
				}).catch((error) => {
					showNotice("error", `${t("toggleError")}: ${error instanceof Error ? error.message : String(error)}`);
				}).finally(() => {
					setBusyKey(null);
				});
			}, [
				busyKey,
				ensureFsTurnFiles,
				hunkSelection,
				invoke,
				mergeResultStates,
				showNotice
			]);
			const runToggle = (0, react.useCallback)((key, items, action) => {
				if (busyKey !== null || items.length === 0) return;
				const candidates = items.filter((item) => {
					if (item.autoSelect !== false) return true;
					const selection = hunkSelection.get(stateKey(item.turn, item.path));
					return selection !== void 0 && selection.size > 0;
				});
				if (candidates.length === 0) return;
				if (candidates.some((item) => item.owner === "multi")) {
					setPendingConfirm({
						key,
						items: candidates,
						action
					});
					return;
				}
				applyToggle(key, candidates, action);
			}, [
				busyKey,
				hunkSelection,
				applyToggle
			]);
			const toggleExpanded = (0, react.useCallback)((key) => {
				setExpanded((current) => {
					const next = new Set(current);
					if (next.has(key)) next.delete(key);
					else next.add(key);
					return next;
				});
			}, []);
			/** 更新一个 (turn, path) 的 hunk 勾选；回到全选时清除条目（隐式全选）。 */
			const changeHunkSelection = (0, react.useCallback)((key, total, next) => {
				setHunkSelection((current) => {
					const map = new Map(current);
					if (next.size >= total) map.delete(key);
					else map.set(key, next);
					return map;
				});
			}, []);
			const selectedHunkCount = (0, react.useCallback)((file, key) => {
				const selection = hunkSelection.get(key);
				return selection === void 0 ? file.diffs.length : selection.size;
			}, [hunkSelection]);
			const openInEditor = (0, react.useCallback)((path) => {
				const absolute = resolveSessionPath(cwd, path);
				ctx.betterSidebar?.openFile({
					sessionId,
					...cwd !== void 0 ? { cwd } : {}
				}, absolute, basename$1(absolute));
			}, [
				ctx,
				cwd,
				sessionId
			]);
			const totalStats = (0, react.useMemo)(() => flat.reduce((total, item) => addStats$1(total, item.counts ?? summarizeDiffs(item.diffs)), {
				added: 0,
				removed: 0
			}), [flat]);
			const timelineForPath = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const turn of turns) for (const file of turn.files) {
					const list = map.get(file.path) ?? [];
					list.push({
						turn: turn.turn,
						live: turn.live,
						diffs: file.diffs,
						...file.deleted === true ? { deleted: true } : {},
						...file.counts !== void 0 ? { counts: file.counts } : {}
					});
					map.set(file.path, list);
				}
				return map;
			}, [turns]);
			const timelineEntries = timelinePath === null ? [] : timelineForPath.get(timelinePath) ?? [];
			const windowStats = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				if (rewindTurn === null) return map;
				for (const entry of flat) {
					if (entry.turn < rewindTurn) continue;
					const existing = map.get(entry.path);
					const stats = entry.counts ?? summarizeDiffs(entry.diffs);
					map.set(entry.path, {
						stats: existing === void 0 ? stats : addStats$1(existing.stats, stats),
						latestTurn: existing === void 0 ? entry.turn : Math.max(existing.latestTurn, entry.turn)
					});
				}
				return map;
			}, [flat, rewindTurn]);
			/** 从时间线/恢复对话框跳到某个（轮, 文件）的差异：关掉浮层、展开该行并滚动
			* 到位（setExpanded 总是产生新 Set，滚动副作用必然重放）。 */
			const jumpToFile = (0, react.useCallback)((turn, path) => {
				setTimelinePath(null);
				setRewindTurn(null);
				const key = stateKey(turn, path);
				setExpanded((current) => {
					const next = new Set(current);
					next.add(key);
					return next;
				});
				pendingScrollRef.current = {
					rowKey: key,
					turn: null
				};
			}, []);
			/** 渲染一个轮组（最新轮在前）。 */
			const renderTurn = (turn) => {
				const turnStats = turn.files.reduce((total, file) => addStats$1(total, file.counts ?? summarizeDiffs(file.diffs)), {
					added: 0,
					removed: 0
				});
				const reversible = turn.files.filter(isReversible);
				const toggleable = turn.files.filter((file) => file.deleted !== true || file.diffs.length > 0 || file.dir === true);
				const hasToggleable = toggleable.some((file) => file.diffs.length > 0 || file.origin === "fs");
				const turnAction = reversible.length > 0 && reversible.every((file) => states.get(stateKey(turn.turn, file.path)) === "undone") ? "redo" : "undo";
				const turnKey = `turn:${turn.turn}`;
				const turnBusy = busyKey === turnKey;
				const otherWrites = turn.files.filter((file) => file.origin === "fs" && file.owner !== void 0 && file.owner !== "target").length;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					ref: (element) => {
						if (element === null) turnRefs.current.delete(turn.turn);
						else turnRefs.current.set(turn.turn, element);
					},
					className: FileReviewTab_module_css_default.turnGroup,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: FileReviewTab_module_css_default.turnHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.turnTitle,
								children: t("turn", { n: turn.turn })
							}),
							turn.live && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.liveBadge,
								children: t("turnLive")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.turnCount,
								children: turn.files.length === 1 ? t("filesOne") : t("files", { count: turn.files.length })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats: turnStats }),
							otherWrites > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.ownerBadge,
								children: t("turnOtherSessions", { count: otherWrites })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.actionButton,
								disabled: statusPending || busyKey !== null || !hasToggleable,
								title: !hasToggleable ? t("toggleUnavailable") : void 0,
								onClick: () => {
									runToggle(turnKey, toggleable.map((file) => ({
										turn: turn.turn,
										path: file.path,
										diffs: file.diffs,
										...file.origin !== void 0 ? { origin: file.origin } : {},
										...file.dir === true ? { dir: true } : {},
										...file.deleted === true ? { deleted: true } : {},
										...fsAttributionOf(file)
									})), turnAction);
								},
								children: [turnAction === "undo" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UndoIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RedoIcon, {}), turnBusy ? t(turnAction === "undo" ? "undoing" : "redoing") : t(turnAction === "undo" ? "undoTurn" : "redoTurn")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.smallButton,
								disabled: busyKey !== null,
								title: t("snapshotRestoreTitle"),
								onClick: (event) => {
									event.stopPropagation();
									ensureFsTurnFiles(turn.turn);
									setRewindTurn(turn.turn);
								},
								children: t("snapshotRestore")
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: FileReviewTab_module_css_default.fileList,
						children: turn.files.map((file) => renderFile(turn, file))
					})]
				}, turn.turn);
			};
			/** 渲染一个被改文件的行；展开时追加其行内 diff。 */
			const renderFile = (turn, file) => {
				const key = stateKey(turn.turn, file.path);
				const isOpen = expanded.has(key);
				const state = states.get(key);
				const reversible = isReversible(file);
				const fsPending = file.origin === "fs" && file.diffs.length === 0;
				const fileAction = state === "undone" ? "redo" : "undo";
				const fileBusy = busyKey === key;
				const stats = file.counts ?? summarizeDiffs(file.diffs);
				const selectedCount = selectedHunkCount(file, key);
				const deletedNoDiff = file.deleted === true && file.diffs.length === 0 && file.dir !== true;
				const fsBadge = file.origin === "fs" ? fsOwnerBadge(file, sessionTitle) : null;
				const expand = () => {
					toggleExpanded(key);
					if (fsPending) ensureFsTurnFiles(turn.turn, [file.path]);
				};
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: FileReviewTab_module_css_default.fileItem,
					ref: (element) => {
						if (element === null) rowRefs.current.delete(key);
						else rowRefs.current.set(key, element);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FileReviewTab_module_css_default.fileRow,
						role: "button",
						tabIndex: 0,
						title: file.path,
						"aria-expanded": isOpen,
						onClick: expand,
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								expand();
							}
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { open: isOpen }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.fileName,
								children: basename$1(file.path)
							}),
							file.deleted === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.deletedBadge,
								children: t("deleted")
							}),
							file.dir === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.deletedBadge,
								children: t("dirBadge")
							}),
							fsBadge !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.ownerBadge,
								children: fsBadge
							}),
							!deletedNoDiff && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats }),
							!deletedNoDiff && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBadge, { state }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.smallButton,
								title: t("timelineTitle"),
								onClick: (event) => {
									event.stopPropagation();
									setTimelinePath(file.path);
								},
								children: t("timeline")
							}),
							file.deleted !== true && file.dir !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.smallButton,
								onClick: (event) => {
									event.stopPropagation();
									openInEditor(file.path);
								},
								children: t("openInEditor")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.smallButton,
								disabled: statusPending || busyKey !== null || !(reversible || fsPending) || (reversible || file.autoSelect === false) && selectedCount === 0,
								title: deletedNoDiff ? t("deletedHint") : !(reversible || fsPending) ? t("toggleUnavailable") : (reversible || file.autoSelect === false) && selectedCount === 0 ? t("hunkNoneSelected") : void 0,
								onClick: (event) => {
									event.stopPropagation();
									runToggle(key, [{
										turn: turn.turn,
										path: file.path,
										diffs: file.diffs,
										...file.origin !== void 0 ? { origin: file.origin } : {},
										...file.dir === true ? { dir: true } : {},
										...file.deleted === true ? { deleted: true } : {},
										...fsAttributionOf(file)
									}], fileAction);
								},
								children: fileBusy ? t(fileAction === "undo" ? "undoing" : "redoing") : t(fileAction === "undo" ? "undo" : "redo")
							})
						]
					}), isOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileReviewTab_module_css_default.diffWrap,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LazyDiff, { children: deletedNoDiff ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: FileReviewTab_module_css_default.diffUnavailable,
							children: t("deletedHint")
						}) : file.dir === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: FileReviewTab_module_css_default.diffUnavailable,
							children: t("dirHint")
						}) : file.diffs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: FileReviewTab_module_css_default.diffUnavailable,
							children: t("unavailable")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnifiedDiff, {
							diffs: file.diffs,
							contextLines: 3,
							showCopyButton: true,
							showFileHeaders: false,
							selectable: true,
							navigation: true,
							selectedHunks: hunkSelection.get(key),
							onSelectedHunksChange: (next) => {
								changeHunkSelection(key, file.diffs.length, next);
							},
							labels: {
								copy: t("copy"),
								copied: t("copied"),
								showUnchanged: (count) => t("showUnchanged", { count }),
								hideUnchanged: (count) => t("hideUnchanged", { count }),
								hunkN: (n) => t("hunkN", { n }),
								hunkInclude: t("hunkInclude")
							},
							className: FileReviewTab_module_css_default.reviewDiff
						}) })
					})]
				}, file.path);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FileReviewTab_module_css_default.root,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: FileReviewTab_module_css_default.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FileReviewTab_module_css_default.headerTitle,
								children: t("tabTitle")
							}),
							flat.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats$1, { stats: totalStats }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.smallButton,
								disabled: gateOn === null,
								title: gateOn === false ? t("gateTitleOff") : t("gateTitleOn"),
								onClick: toggleGate,
								children: gateOn === null ? t("gateUnknown") : gateOn ? t("gateOn") : t("gateOff")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: FileReviewTab_module_css_default.refreshButton,
								disabled: statusPending,
								title: t("refresh"),
								onClick: () => {
									setTick((value) => value + 1);
								},
								children: "⟳"
							})
						]
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `${FileReviewTab_module_css_default.notice} ${notice.tone === "success" ? FileReviewTab_module_css_default.noticeSuccess : FileReviewTab_module_css_default.noticeError}`,
						role: "alert",
						children: notice.text
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FileReviewTab_module_css_default.body,
						ref: bodyRef,
						children: turns.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: FileReviewTab_module_css_default.empty,
							children: t("empty")
						}) : [...turns].reverse().map(renderTurn)
					}),
					rewindTurn !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TurnRewindDialog, {
						sessionId,
						turn: rewindTurn,
						windowStats,
						onJumpToDiff: jumpToFile,
						sessionTitle,
						onClose: () => {
							setRewindTurn(null);
						},
						onRestored: () => {
							setTick((value) => value + 1);
							showNotice("success", t("snapshotDone"));
						}
					}),
					pendingConfirm !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MultiSessionConfirmDialog, {
						items: pendingConfirm.items,
						action: pendingConfirm.action,
						sessionTitle,
						onCancel: () => {
							setPendingConfirm(null);
						},
						onManual: () => {
							const conflicts = pendingConfirm.items.filter((item) => item.owner === "multi");
							setPendingConfirm(null);
							for (const item of conflicts) ensureFsTurnFiles(item.turn, [item.path]);
							setExpanded((current) => {
								const next = new Set(current);
								for (const item of conflicts) next.add(stateKey(item.turn, item.path));
								return next;
							});
							const first = conflicts[0];
							if (first !== void 0) pendingScrollRef.current = {
								rowKey: stateKey(first.turn, first.path),
								turn: null
							};
						},
						onProceed: () => {
							const pending = pendingConfirm;
							setPendingConfirm(null);
							applyToggle(pending.key, pending.items, pending.action);
						}
					}),
					timelinePath !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileTimelineDialog, {
						path: timelinePath,
						entries: timelineEntries,
						onPick: (turn) => {
							jumpToFile(turn, timelinePath);
						},
						onClose: () => {
							setTimelinePath(null);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/turn-deliverables.ts
		/**
		* 单轮作用域的产出文件定义与读取器。纯客户端、与模型无关：词汇来源是变更
		* 工具自己的**结果**，绝不是收尾文风。
		*
		* dsh 0.1.2 迁移：会话视图（callView / resultView 卡片）机制随 client
		* runtime 移除，ConversationMatch 不再携带 view。produced 路径与 hunks 改
		* 从会话事件直接派生——`tool/call` 的原始参数给出路径与「意图 hunk」，
		* `tool/result` 的 `meta.diffs`（dsh-tool-fs 的 presentationMeta）给出落地
		* 后的真实 hunks，两者的形状与本插件的 ProducedFileDiff 完全一致。
		*/
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function pathValue(value) {
			return typeof value === "string" && value !== "" ? value : null;
		}
		function parseArgs(argsRaw) {
			try {
				const args = JSON.parse(argsRaw);
				return isRecord(args) ? args : null;
			} catch {
				return null;
			}
		}
		/**
		* 从一次受支持的一方变更调用里抽出变更路径与意图 hunks。会话 `tool/call`
		* 事件都是根调用；Code Dispatch 的子调用不会独立进入这个 Definition。
		*/
		function mutationIntent(name, argsRaw) {
			const args = parseArgs(argsRaw);
			if (args === null) return null;
			switch (name) {
				case "write": {
					const path = pathValue(args.file_path);
					const content = args.content;
					if (path === null || typeof content !== "string") return null;
					return {
						path,
						intended: [{
							path,
							oldText: null,
							newText: content
						}],
						deletions: []
					};
				}
				case "edit": {
					const path = pathValue(args.file_path);
					const { old_string: oldString, new_string: newString } = args;
					if (path === null || typeof oldString !== "string" || typeof newString !== "string" || oldString === "" || oldString === newString) return null;
					return {
						path,
						intended: [{
							path,
							oldText: oldString,
							newText: newString
						}],
						deletions: []
					};
				}
				case "str_replace_editor": {
					const path = pathValue(args.path);
					if (path === null) return null;
					if (args.command === "create" && typeof args.file_text === "string") return {
						path,
						intended: [{
							path,
							oldText: null,
							newText: args.file_text
						}],
						deletions: []
					};
					if (args.command === "str_replace" && typeof args.old_str === "string" && typeof args.new_str === "string" && args.old_str !== "") return {
						path,
						intended: [{
							path,
							oldText: args.old_str,
							newText: args.new_str
						}],
						deletions: []
					};
					return {
						path,
						intended: [],
						deletions: []
					};
				}
				default: return {
					path: null,
					intended: [],
					deletions: deletedPathsFromCall(name, argsRaw)
				};
			}
		}
		/** 校验跨宿主/浏览器传输的 diff hunks（未知即拒绝，绝不猜）。 */
		function producedDiffs(meta) {
			if (!isRecord(meta) || !Array.isArray(meta.diffs)) return [];
			const diffs = [];
			for (const value of meta.diffs) {
				if (!isRecord(value)) return rejectDiffs(meta.diffs.length);
				const { path, oldText, newText, oldStart, newStart } = value;
				if (typeof path !== "string" || oldText !== null && typeof oldText !== "string" || typeof newText !== "string" || oldStart !== void 0 && (typeof oldStart !== "number" || !Number.isInteger(oldStart) || oldStart < 1) || newStart !== void 0 && (typeof newStart !== "number" || !Number.isInteger(newStart) || newStart < 1)) return rejectDiffs(meta.diffs.length);
				diffs.push({
					path,
					oldText,
					newText,
					...typeof oldStart === "number" ? { oldStart } : {},
					...typeof newStart === "number" ? { newStart } : {}
				});
			}
			return diffs;
		}
		/** 一条 hunk 形状不完整就整组丢弃是刻意设计（宿主撤销要求全量可逆）；
		* 但静默丢弃曾让「文件在列、撤销永久禁用」无从排查——至少留痕。 */
		function rejectDiffs(total) {
			console.warn(`[dsh-shadow-rewind] diff 视图中存在不可解析的 hunk，整组丢弃（共 ${String(total)} 条）`);
			return [];
		}
		/**
		* 某个收尾 Assistant 边界处可见的文件与审查 hunks。
		* @param data - 引擎为某一 Turn 发布的 Deliverables 数据。
		* @param seq - 收尾的 Assistant seq；在此之后的工具结算一律排除。
		* @returns 产出文件按首次出现顺序，同路径 hunks 按结算顺序追加。
		*/
		function reviewsForClosing(data, seq = Number.POSITIVE_INFINITY) {
			if (data === void 0) return [];
			const reviews = [];
			const byPath = /* @__PURE__ */ new Map();
			for (const produced of data.produced) {
				if (produced.seq > seq) continue;
				const review = byPath.get(produced.path);
				if (review === void 0) {
					const created = {
						path: produced.path,
						diffs: [...produced.diffs],
						...produced.deleted === true ? { deleted: true } : {}
					};
					byPath.set(produced.path, created);
					reviews.push(created);
				} else {
					review.diffs.push(...produced.diffs);
					if (produced.deleted === true) review.deleted = true;
					else delete review.deleted;
				}
			}
			return reviews;
		}
		/**
		* 只有收尾轮真的产出过文件时才认领轮尾链。
		* @param owner - 收尾 assistant 的轮尾 owner 货币。
		* @returns 作为组件 match 的产出文件审查，或 null 表示在挂载前放弃认领。
		*/
		function selectProducedFiles(owner) {
			const reviews = reviewsForClosing(owner.turn.data.get("deliverables"), owner.seq);
			return reviews.length === 0 ? null : reviews;
		}
		/** Turn 局部的成功变更累积器；它不发布任何视图节点。 */
		const deliverablesDefinition = {
			kind: "deliverables",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "tool/call") return {
					id: String(event.data.turn),
					role: "update"
				};
				if (event.type === "tool/result" && (0, _deepseek_ai_dsh_session_surface.isAppendSurfaceEvent)(event)) return {
					id: String(event.data.turn),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "turn/start") throw new Error("deliverables start requires turn/start");
				const turn = match.event.data.turn;
				return {
					turn: typeof turn === "number" ? turn : 0,
					calls: /* @__PURE__ */ new Map(),
					produced: []
				};
			},
			update: (context, match) => {
				if (match.event.type === "tool/call") {
					const intent = mutationIntent(match.event.data.name, match.event.data.arguments);
					const calls = new Map(context.state.calls);
					calls.set(String(match.event.data.callId), intent);
					return {
						...context.state,
						calls
					};
				}
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.message.content[0].isError === true) return context.state;
				const callId = String(match.event.data.message.source.callId);
				const intent = context.state.calls.get(callId);
				if (intent === void 0 || intent === null) return context.state;
				const applied = producedDiffs(match.event.data.meta);
				const diffs = applied.length > 0 ? applied : intent.intended;
				const seq = match.event.seq;
				const additions = [];
				if (intent.path !== null) additions.push({
					seq,
					path: intent.path,
					diffs: diffs.filter((diff) => diff.path === intent.path)
				});
				for (const path of intent.deletions) {
					if (additions.some((addition) => addition.path === path)) continue;
					additions.push({
						seq,
						path,
						diffs: [],
						deleted: true
					});
				}
				return additions.length === 0 ? context.state : {
					...context.state,
					produced: [...context.state.produced, ...additions]
				};
			},
			buildLocationData: (context, scope, previous) => {
				if (scope !== "turn" || context.state === void 0) return null;
				if (previous?.kind === "turn" && previous.turn === context.state.turn && previous.key === "deliverables" && previous.value.produced === context.state.produced) return previous;
				return {
					kind: "turn",
					turn: context.state.turn,
					key: "deliverables",
					value: { produced: context.state.produced }
				};
			}
		};
		/**
		* 路径末段——一眼就能认出文件的那一部分。
		* @param path - 用斜杠或反斜杠分隔的路径。
		* @returns 末段；没有分隔符时返回整串。
		*/
		function basename(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/**
		* 一轮产出路径之上的「文件提及」词汇，供收尾消息的行文使用：行内代码 token
		* 会打开它点名的文件。token 先按完整路径精确解析，再退而求其次——恰好等于
		* **唯一一个**产出路径的 basename。两个路径共用的 basename 保持惰性、绝不
		* 猜，于是提及链接永远不会打开错误的文件或 404。
		* @param paths - 本轮产出路径（工具顺序，已去重）。
		* @param openFile - 聊天视图的文件 opener。
		* @param label - 为已解析路径本地化可访问的打开标签。
		* @returns MarkdownText 消费的 resolver；完整路径乘在 `title` 上，与文件行
		* 上的 chip 用同一消歧标识。
		*/
		function producedFileMentions(paths, openFile, label) {
			return { resolve(value) {
				const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value);
				if (path === void 0) return void 0;
				return {
					open: () => {
						openFile(path);
					},
					label: label(path),
					title: path
				};
			} };
		}
		/** basename 恰好等于 `value` 的产出路径；多于一个或没有都返回 undefined。 */
		function onlyPathWithBasename(paths, value) {
			const matches = paths.filter((path) => basename(path) === value);
			return matches.length === 1 ? matches[0] : void 0;
		}
		//#endregion
		//#region \0dsh-shadow-rewind-css:D:\dsh-pulgn\dsh-shadow-rewind\src\client\ProducedFiles.module.css.mjs
		const css = "._7vv1Uq_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);color:var(--dsw-alias-label-primary);border-radius:12px;margin-top:16px;font-size:13px;overflow:hidden}._7vv1Uq_cardHeader{align-items:center;gap:10px;min-height:56px;padding:0 12px;display:flex}._7vv1Uq_fileIconWrap{background:var(--dsw-alias-interactive-bg-hover);width:30px;height:30px;color:var(--dsw-alias-label-secondary);border-radius:8px;flex:none;place-items:center;display:grid}._7vv1Uq_icon,._7vv1Uq_buttonIcon,._7vv1Uq_closeIcon{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.4px}._7vv1Uq_icon{width:18px;height:18px}._7vv1Uq_buttonIcon{width:16px;height:16px}._7vv1Uq_closeIcon{width:20px;height:20px}._7vv1Uq_cardTitleBlock{flex:auto;align-items:baseline;gap:10px;min-width:0;display:flex}._7vv1Uq_cardTitle{text-overflow:ellipsis;white-space:nowrap;font-weight:600;overflow:hidden}._7vv1Uq_stats{font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;gap:5px;display:inline-flex}._7vv1Uq_added{color:var(--dsw-alias-state-success-primary)}._7vv1Uq_removed{color:var(--dsw-alias-state-error-primary)}._7vv1Uq_statBar{background:var(--dsw-alias-border-l1);border-radius:999px;flex:none;width:48px;height:4px;display:inline-flex;overflow:hidden}._7vv1Uq_statBarAdded{background:var(--dsw-alias-state-success-primary);height:100%}._7vv1Uq_statBarRemoved{background:var(--dsw-alias-state-error-primary);height:100%}._7vv1Uq_dirRow{border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-container,Canvas);width:100%;min-height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;text-align:left;align-items:center;gap:6px;padding:0 10px 0 12px;font-size:12px;display:flex}._7vv1Uq_dirRow:hover{background:var(--dsw-alias-interactive-bg-hover)}._7vv1Uq_dirToggle{width:12px;color:var(--dsw-alias-label-tertiary);flex:none}._7vv1Uq_dirName{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-primary);font-weight:600;overflow:hidden}._7vv1Uq_dirCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:auto}._7vv1Uq_dirIndent{flex:none;display:inline-block}._7vv1Uq_reviewButton,._7vv1Uq_toggleButton,._7vv1Uq_toolbarButton,._7vv1Uq_openButton,._7vv1Uq_closeButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit}._7vv1Uq_reviewButton,._7vv1Uq_toggleButton,._7vv1Uq_toolbarButton{border-radius:8px;flex:none;align-items:center;gap:6px;min-height:30px;padding:0 10px;display:inline-flex}._7vv1Uq_reviewButton:hover,._7vv1Uq_toggleButton:hover:not(:disabled),._7vv1Uq_toolbarButton:hover:not(:disabled),._7vv1Uq_openButton:hover,._7vv1Uq_closeButton:hover{background:var(--dsw-alias-interactive-bg-hover)}._7vv1Uq_reviewButton:focus-visible,._7vv1Uq_toggleButton:focus-visible,._7vv1Uq_toolbarButton:focus-visible,._7vv1Uq_openButton:focus-visible,._7vv1Uq_closeButton:focus-visible,._7vv1Uq_fileRow:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}._7vv1Uq_fileList{border-top:1px solid var(--dsw-alias-border-l1);max-height:304px;overflow-y:auto}._7vv1Uq_fileRow{border-bottom:1px solid var(--dsw-alias-border-l1);align-items:stretch;width:100%;min-height:38px;display:flex}._7vv1Uq_fileLink{min-width:0;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;flex:auto;align-items:center;gap:12px;margin:0;padding:0 0 0 12px;display:flex}._7vv1Uq_fileLink:hover{background:var(--dsw-alias-interactive-bg-hover)}._7vv1Uq_fileUndoButton{width:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:7px;flex:none;place-items:center;margin:0 6px;padding:0;display:grid}._7vv1Uq_fileUndoButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._7vv1Uq_fileUndoButton:disabled{cursor:default;opacity:.45}._7vv1Uq_fileLink:focus-visible,._7vv1Uq_fileUndoButton:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}._7vv1Uq_fileName{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}._7vv1Uq_drawer{z-index:1000;width:var(--review-drawer-width,36vw);border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);max-width:100vw;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;position:fixed;inset:0 0 0 auto;box-shadow:-12px 0 32px #0000001f}._7vv1Uq_drawerSplit{z-index:1;box-shadow:none}._7vv1Uq_drawerResizing,._7vv1Uq_drawerResizing *{cursor:col-resize;user-select:none}._7vv1Uq_resizeHandle{z-index:5;cursor:col-resize;touch-action:none;background:0 0;border:0;width:12px;margin:0;padding:0;position:absolute;inset:0 auto 0 -6px}._7vv1Uq_resizeHandle:after{content:\"\";background:0 0;width:2px;transition:background .12s;position:absolute;inset:0 auto 0 5px}._7vv1Uq_resizeHandle:hover:after,._7vv1Uq_resizeHandle:focus-visible:after,._7vv1Uq_drawerResizing ._7vv1Uq_resizeHandle:after{background:var(--dsw-alias-border-l3)}._7vv1Uq_resizeHandle:focus-visible{outline:none}._7vv1Uq_drawerHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;align-items:center;gap:12px;min-height:64px;padding:0 14px 0 18px;display:flex}._7vv1Uq_drawerHeading{flex-direction:column;flex:auto;gap:2px;min-width:0;display:flex}._7vv1Uq_drawerTitle{font-size:15px;font-weight:600;line-height:20px}._7vv1Uq_drawerSubtitle{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:16px;overflow:hidden}._7vv1Uq_toolbarButton:disabled,._7vv1Uq_toggleButton:disabled{cursor:default;opacity:.45}._7vv1Uq_toast{z-index:1200;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);width:min(430px,100vw - 32px);color:var(--dsw-alias-label-primary);border-radius:14px;padding:14px;position:fixed;top:120px;left:50%;transform:translate(-50%);box-shadow:0 8px 24px #00000029}._7vv1Uq_toastSuccess{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 28%, transparent);width:auto;min-width:220px;max-width:min(430px,100vw - 32px);padding:8px 10px}._7vv1Uq_toastError{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent)}._7vv1Uq_toastHeader{align-items:flex-start;gap:10px;display:flex}._7vv1Uq_noticeIcon{border-radius:9px;flex:none;place-items:center;width:30px;height:30px;display:grid}._7vv1Uq_toastSuccess ._7vv1Uq_noticeIcon{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);color:var(--dsw-alias-state-success-primary)}._7vv1Uq_toastError ._7vv1Uq_noticeIcon{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary)}._7vv1Uq_noticeIconSvg{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.7px;width:18px;height:18px}._7vv1Uq_toastCopy{flex-direction:column;flex:auto;gap:3px;min-width:0;padding-top:3px;display:flex}._7vv1Uq_toastTitle{font-size:14px;font-weight:600;line-height:20px}._7vv1Uq_toastDescription{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}._7vv1Uq_toastCloseButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:7px;flex:none;place-items:center;padding:0;display:grid}._7vv1Uq_toastCloseButton:hover,._7vv1Uq_toastCloseButton:focus-visible,._7vv1Uq_noticeFileButton:hover,._7vv1Uq_noticeFileButton:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}._7vv1Uq_toastCloseButton:focus-visible,._7vv1Uq_noticeFileButton:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}._7vv1Uq_noticeFiles{margin:12px 0 0 40px}._7vv1Uq_noticeFileListLabel{color:var(--dsw-alias-label-secondary);margin:0 8px 4px;font-size:12px;line-height:18px;display:block}._7vv1Uq_noticeFileList{flex-direction:column;gap:2px;max-height:220px;margin:0;padding:0;list-style:none;display:flex;overflow:auto}._7vv1Uq_noticeFileButton{width:100%;min-height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;border-radius:7px;align-items:center;gap:12px;padding:5px 8px;display:flex}._7vv1Uq_noticeFilePath{min-width:0;font:var(--dsw-font-markdown-code-block);text-overflow:ellipsis;white-space:nowrap;flex:auto;overflow:hidden}._7vv1Uq_noticeFileArrow{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;font-size:14px}._7vv1Uq_noticeDismissButton{background:var(--dsw-alias-label-primary);width:100%;min-height:34px;color:var(--dsw-alias-bg-container,Canvas);cursor:pointer;font:inherit;border:0;border-radius:8px;margin-top:12px;padding:0 12px;font-weight:600}._7vv1Uq_noticeDismissButton:hover{opacity:.9}._7vv1Uq_noticeDismissButton:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px}._7vv1Uq_closeButton{background:0 0;border-color:#0000;border-radius:8px;flex:none;place-items:center;width:32px;height:32px;padding:0;display:grid}._7vv1Uq_drawerBody{flex:auto;min-height:0;overflow:auto}._7vv1Uq_reviewFile+._7vv1Uq_reviewFile{border-top:8px solid var(--dsw-alias-border-l1)}._7vv1Uq_reviewFileHeader{z-index:2;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);min-height:44px;font:var(--dsw-font-markdown-code-block);align-items:center;gap:8px;padding:0 12px;display:flex;position:sticky;top:0}._7vv1Uq_reviewStatus{color:var(--dsw-alias-state-success-primary);font-weight:700}._7vv1Uq_reviewPath{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}._7vv1Uq_openButton{min-height:28px;font:var(--dsw-font-xs-13);border-radius:7px;flex:none;padding:0 9px}._7vv1Uq_reviewDiff{color:var(--dsw-alias-label-primary)}._7vv1Uq_reviewUnavailable{background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);margin:0;padding:22px 16px;font-size:13px;line-height:20px}@media (width<=760px){._7vv1Uq_cardHeader{flex-wrap:wrap;padding-block:10px}._7vv1Uq_cardTitleBlock{flex-direction:column;gap:1px}._7vv1Uq_drawer{border-left:0;width:100vw}._7vv1Uq_resizeHandle{display:none}._7vv1Uq_drawerHeader{gap:8px;padding-left:12px}._7vv1Uq_toolbarButton{color:#0000;justify-content:center;width:32px;padding:0;overflow:hidden}._7vv1Uq_toolbarButton ._7vv1Uq_buttonIcon{color:var(--dsw-alias-label-primary)}._7vv1Uq_reviewFileHeader{flex-wrap:wrap;padding-block:8px}._7vv1Uq_reviewPath{flex-basis:calc(100% - 30px)}._7vv1Uq_openButton{margin-left:auto}}@media (prefers-reduced-motion:no-preference){._7vv1Uq_drawer{animation:.16s ease-out _7vv1Uq_drawer-enter}}@keyframes _7vv1Uq_drawer-enter{0%{opacity:0;transform:translate(20px)}to{opacity:1;transform:translate(0)}}._7vv1Uq_deletedBadge{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);white-space:nowrap;border-radius:999px;padding:1px 6px;font-size:11px}._7vv1Uq_diffPopover{z-index:1300;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-container,Canvas);max-height:min(480px,60vh);color:var(--dsw-alias-label-primary);border-radius:10px;flex-direction:column;font-size:12px;display:flex;position:fixed;overflow:hidden;box-shadow:0 12px 32px #0000002e}._7vv1Uq_diffPopoverHeader{border-bottom:1px solid var(--dsw-alias-border-l1);min-height:36px;font:var(--dsw-font-markdown-code-block);flex:none;align-items:center;gap:10px;padding:0 12px;display:flex}._7vv1Uq_diffPopoverPath{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}._7vv1Uq_diffPopoverBody{flex:auto;min-height:0;overflow:auto}._7vv1Uq_liveBar{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-container,Canvas);color:var(--dsw-alias-label-secondary);border-radius:8px;flex-direction:column;align-items:stretch;font-size:12px;display:flex}._7vv1Uq_liveBarHeader{align-items:center;gap:8px;min-height:32px;padding:0 10px;display:flex}._7vv1Uq_liveDot{background:var(--dsw-alias-state-success-primary);border-radius:50%;flex:none;width:7px;height:7px;animation:1.6s ease-in-out infinite _7vv1Uq_live-pulse}@keyframes _7vv1Uq_live-pulse{0%,to{opacity:1}50%{opacity:.35}}._7vv1Uq_liveTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;flex:none}._7vv1Uq_liveFiles{border-top:1px solid var(--dsw-alias-border-l1);flex-direction:column;max-height:256px;display:flex;overflow-y:auto}._7vv1Uq_liveFileRow{width:100%;min-height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;align-items:center;gap:8px;padding:0 10px;display:flex}._7vv1Uq_liveFileRow:hover{background:var(--dsw-alias-interactive-bg-hover)}._7vv1Uq_liveFileRow:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}._7vv1Uq_liveFileRow ._7vv1Uq_fileName{color:var(--dsw-alias-label-secondary)}._7vv1Uq_liveFileRow ._7vv1Uq_stats{margin-left:auto}@media (prefers-reduced-motion:reduce){._7vv1Uq_liveDot{animation:none}}";
		const styleId = "dsh-shadow-rewind/ProducedFiles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-shadow-rewind";
			style.dataset.pluginCss = styleId;
			style.textContent = css;
			document.head.appendChild(style);
		}
		var ProducedFiles_module_css_default = {
			"cardHeader": "_7vv1Uq_cardHeader",
			"closeButton": "_7vv1Uq_closeButton",
			"toastHeader": "_7vv1Uq_toastHeader",
			"toastCloseButton": "_7vv1Uq_toastCloseButton",
			"drawerResizing": "_7vv1Uq_drawerResizing",
			"noticeFileListLabel": "_7vv1Uq_noticeFileListLabel",
			"closeIcon": "_7vv1Uq_closeIcon",
			"toastError": "_7vv1Uq_toastError",
			"buttonIcon": "_7vv1Uq_buttonIcon",
			"fileList": "_7vv1Uq_fileList",
			"resizeHandle": "_7vv1Uq_resizeHandle",
			"drawerTitle": "_7vv1Uq_drawerTitle",
			"toastSuccess": "_7vv1Uq_toastSuccess",
			"noticeFileList": "_7vv1Uq_noticeFileList",
			"deletedBadge": "_7vv1Uq_deletedBadge",
			"liveDot": "_7vv1Uq_liveDot",
			"drawerHeader": "_7vv1Uq_drawerHeader",
			"diffPopoverBody": "_7vv1Uq_diffPopoverBody",
			"reviewFileHeader": "_7vv1Uq_reviewFileHeader",
			"openButton": "_7vv1Uq_openButton",
			"reviewButton": "_7vv1Uq_reviewButton",
			"diffPopoverHeader": "_7vv1Uq_diffPopoverHeader",
			"stats": "_7vv1Uq_stats",
			"liveBarHeader": "_7vv1Uq_liveBarHeader",
			"fileName": "_7vv1Uq_fileName",
			"cardTitle": "_7vv1Uq_cardTitle",
			"reviewDiff": "_7vv1Uq_reviewDiff",
			"diffPopoverPath": "_7vv1Uq_diffPopoverPath",
			"drawer": "_7vv1Uq_drawer",
			"drawerBody": "_7vv1Uq_drawerBody",
			"cardTitleBlock": "_7vv1Uq_cardTitleBlock",
			"dirIndent": "_7vv1Uq_dirIndent",
			"statBarAdded": "_7vv1Uq_statBarAdded",
			"liveFileRow": "_7vv1Uq_liveFileRow",
			"toggleButton": "_7vv1Uq_toggleButton",
			"fileIconWrap": "_7vv1Uq_fileIconWrap",
			"dirToggle": "_7vv1Uq_dirToggle",
			"drawer-enter": "_7vv1Uq_drawer-enter",
			"drawerSplit": "_7vv1Uq_drawerSplit",
			"drawerSubtitle": "_7vv1Uq_drawerSubtitle",
			"dirCount": "_7vv1Uq_dirCount",
			"fileRow": "_7vv1Uq_fileRow",
			"removed": "_7vv1Uq_removed",
			"reviewPath": "_7vv1Uq_reviewPath",
			"noticeIconSvg": "_7vv1Uq_noticeIconSvg",
			"noticeDismissButton": "_7vv1Uq_noticeDismissButton",
			"dirRow": "_7vv1Uq_dirRow",
			"toastDescription": "_7vv1Uq_toastDescription",
			"live-pulse": "_7vv1Uq_live-pulse",
			"reviewFile": "_7vv1Uq_reviewFile",
			"card": "_7vv1Uq_card",
			"toolbarButton": "_7vv1Uq_toolbarButton",
			"dirName": "_7vv1Uq_dirName",
			"fileLink": "_7vv1Uq_fileLink",
			"toastTitle": "_7vv1Uq_toastTitle",
			"drawerHeading": "_7vv1Uq_drawerHeading",
			"noticeIcon": "_7vv1Uq_noticeIcon",
			"noticeFileArrow": "_7vv1Uq_noticeFileArrow",
			"toast": "_7vv1Uq_toast",
			"noticeFilePath": "_7vv1Uq_noticeFilePath",
			"reviewUnavailable": "_7vv1Uq_reviewUnavailable",
			"statBar": "_7vv1Uq_statBar",
			"liveFiles": "_7vv1Uq_liveFiles",
			"liveBar": "_7vv1Uq_liveBar",
			"statBarRemoved": "_7vv1Uq_statBarRemoved",
			"fileUndoButton": "_7vv1Uq_fileUndoButton",
			"noticeFiles": "_7vv1Uq_noticeFiles",
			"toastCopy": "_7vv1Uq_toastCopy",
			"added": "_7vv1Uq_added",
			"liveTitle": "_7vv1Uq_liveTitle",
			"diffPopover": "_7vv1Uq_diffPopover",
			"icon": "_7vv1Uq_icon",
			"reviewStatus": "_7vv1Uq_reviewStatus",
			"noticeFileButton": "_7vv1Uq_noticeFileButton"
		};
		//#endregion
		//#region src/client/diff-popover.tsx
		function DiffPopover({ review, anchor, stats, statsLabel, t, onEnter, onLeave }) {
			const above = anchor.top > 300;
			const width = Math.min(anchor.width, window.innerWidth - 16);
			const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProducedFiles_module_css_default.diffPopover,
				style: {
					width,
					left,
					...above ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }
				},
				role: "tooltip",
				onMouseEnter: onEnter,
				onMouseLeave: onLeave,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: ProducedFiles_module_css_default.diffPopoverHeader,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ProducedFiles_module_css_default.diffPopoverPath,
						title: review.path,
						children: review.path
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ProducedFiles_module_css_default.stats,
						"aria-label": statsLabel,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ProducedFiles_module_css_default.added,
							children: ["+", stats.added]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ProducedFiles_module_css_default.removed,
							children: ["-", stats.removed]
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ProducedFiles_module_css_default.diffPopoverBody,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnifiedDiff, {
						diffs: review.diffs,
						contextLines: 3,
						showFileHeaders: false,
						labels: {
							copy: t("review.copy"),
							copied: t("review.copied"),
							showUnchanged: (count) => t("review.showUnchanged", { count: String(count) }),
							hideUnchanged: (count) => t("review.hideUnchanged", { count: String(count) }),
							hunkN: (n) => t("review.hunkN", { n: String(n) }),
							hunkInclude: t("review.hunkInclude")
						},
						className: ProducedFiles_module_css_default.reviewDiff
					})
				})]
			});
		}
		//#endregion
		//#region src/client/dir-tree.ts
		/** 构建目录树。输入路径顺序 = 输出同层顺序（不重排，保持上游排序）。 */
		function buildDirTree(paths) {
			const root = {
				children: /* @__PURE__ */ new Map(),
				leaf: false
			};
			for (const path of paths) {
				const parts = path.split("/");
				let node = root;
				for (let i = 0; i < parts.length - 1; i++) {
					const part = parts[i];
					let child = node.children.get(part);
					if (child === void 0) {
						child = {
							children: /* @__PURE__ */ new Map(),
							leaf: false
						};
						node.children.set(part, child);
					}
					node = child;
				}
				const name = parts[parts.length - 1];
				node.children.set(name, {
					children: /* @__PURE__ */ new Map(),
					leaf: true
				});
			}
			const collapse = (node, prefix) => {
				const out = [];
				for (const [name, child] of node.children) {
					const path = prefix === "" ? name : `${prefix}/${name}`;
					if (child.leaf) {
						out.push({
							name,
							path
						});
						continue;
					}
					let dirName = name;
					let cursor = child;
					while (!cursor.leaf && cursor.children.size === 1) {
						const [nextName, nextNode] = [...cursor.children.entries()][0];
						if (nextNode.leaf) break;
						dirName = `${dirName}/${nextName}`;
						cursor = nextNode;
					}
					const dirPath = prefix === "" ? dirName : `${prefix}/${dirName}`;
					out.push({
						name: dirName,
						path: dirPath,
						children: collapse(cursor, dirPath)
					});
				}
				return out;
			};
			return collapse(root, "");
		}
		/** 目录节点聚合的文件数（含子目录内；纯函数）。 */
		function countLeafFiles(nodes) {
			let count = 0;
			for (const node of nodes) count += node.children === void 0 ? 1 : countLeafFiles(node.children);
			return count;
		}
		//#endregion
		//#region src/client/ProducedFiles.tsx
		/**
		* ProducedFiles —— 一轮结束后收尾的审查卡片。路径与 hunks 一律来自变更工具
		* 的**结果**，绝不是收尾文风。
		*
		* 侧边栏 tab 移植：原先的 Review DRAWER（劫持宿主网格的细节列）已移除——它
		* 跟 better-sidebar 面板争同一块屏幕边缘。现在「审查」按钮与单文件 chip 改
		* 打开本插件的 better-sidebar `file-review` tab，把整轮路径（或点中的那一个
		* 路径）作为 `meta.expandPaths` 带上，tab 据此精确展开那些 diff。
		* 撤销/重新应用开关保持不变。
		*/
		const SUCCESS_NOTICE_DURATION = 2e3;
		const ERROR_NOTICE_DURATION = 5e3;
		/** 注入缺席时的占位巡检/操作：如实报告「宿主不可用」，绝不假装成功。 */
		const unavailableChanges = async (request) => ({ files: request.files.map((file) => ({
			path: file.path,
			state: "unsupported",
			changed: false,
			reason: "Host file toggle is unavailable"
		})) });
		const unavailableSessionChanges = async (_sessionId, request) => unavailableChanges(request);
		function FileIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.icon,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M11.25 2.75v3.5h3.5M7 10h5M7 13h5" })]
			});
		}
		function ReviewIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.buttonIcon,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4.5 3.5h8a1 1 0 0 1 1 1v3M6.5 6.5h4M6.5 9.5h2.25" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m10.5 13 1.5 1.5 3.5-4" })]
			});
		}
		function CloseIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.closeIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m5.5 5.5 9 9m0-9-9 9" })
			});
		}
		function FileUndoIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.buttonIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 5 4 9l4 4M4 9h7a5 5 0 0 1 5 5v1" })
			});
		}
		function FileRedoIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.buttonIcon,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m12 5 4 4-4 4M16 9H9a5 5 0 0 0-5 5v1" })
			});
		}
		function SuccessIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.noticeIconSvg,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m5 10 3.25 3.25L15 6.5" })
			});
		}
		function ErrorIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				className: ProducedFiles_module_css_default.noticeIconSvg,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "10",
					cy: "10",
					r: "6.5"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m7.5 7.5 5 5m0-5-5 5" })]
			});
		}
		function ResultToast({ notice, closeLabel, dismissLabel, fileListLabel, fileOpenLabel, openFile, onDone }) {
			(0, react.useEffect)(() => {
				const duration = notice.tone === "success" ? SUCCESS_NOTICE_DURATION : ERROR_NOTICE_DURATION;
				const timer = window.setTimeout(onDone, duration);
				return () => {
					window.clearTimeout(timer);
				};
			}, [notice.tone, onDone]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${ProducedFiles_module_css_default.toast} ${notice.tone === "success" ? ProducedFiles_module_css_default.toastSuccess : ProducedFiles_module_css_default.toastError}`,
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProducedFiles_module_css_default.toastHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.noticeIcon,
								children: notice.tone === "success" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SuccessIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProducedFiles_module_css_default.toastCopy,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									className: ProducedFiles_module_css_default.toastTitle,
									children: notice.title
								}), notice.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.toastDescription,
									children: notice.description
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ProducedFiles_module_css_default.toastCloseButton,
								"aria-label": closeLabel,
								onClick: onDone,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, {})
							})
						]
					}),
					notice.files.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProducedFiles_module_css_default.noticeFiles,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.noticeFileListLabel,
							children: fileListLabel
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: ProducedFiles_module_css_default.noticeFileList,
							children: notice.files.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ProducedFiles_module_css_default.noticeFileButton,
								"aria-label": fileOpenLabel(file.path),
								onClick: () => {
									openFile(file.path);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.noticeFilePath,
									children: basename(file.path)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.noticeFileArrow,
									"aria-hidden": "true",
									children: "↗"
								})]
							}) }, file.path))
						})]
					}),
					notice.tone === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ProducedFiles_module_css_default.noticeDismissButton,
						onClick: onDone,
						children: dismissLabel
					})
				]
			});
		}
		function addStats(left, right) {
			return {
				added: left.added + right.added,
				removed: left.removed + right.removed
			};
		}
		function Stats({ stats, label }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ProducedFiles_module_css_default.stats,
				"aria-label": label,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ProducedFiles_module_css_default.added,
					children: ["+", stats.added]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ProducedFiles_module_css_default.removed,
					children: ["-", stats.removed]
				})]
			});
		}
		/** 增/删比例色条（GitHub 式红绿两段条）：数字之外的即时视觉印象。 */
		function StatBar({ stats }) {
			const total = stats.added + stats.removed;
			if (total <= 0) return null;
			const addedPct = Math.round(stats.added / total * 100);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ProducedFiles_module_css_default.statBar,
				"aria-hidden": "true",
				children: [stats.added > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ProducedFiles_module_css_default.statBarAdded,
					style: { width: `${String(addedPct)}%` }
				}), stats.removed > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ProducedFiles_module_css_default.statBarRemoved,
					style: { width: `${String(100 - addedPct)}%` }
				})]
			});
		}
		/** 把一轮的产出文件渲染成摘要卡片，并提供打开侧边栏 tab 的入口。 */
		function ProducedFiles({ matched: matchedReviews, openFile, turn: turnLocation, sessionId, projectRootFor, inspectChanges: inspectChangesFor = unavailableSessionChanges, applyChanges: applyChangesFor = unavailableSessionChanges, openInSidebarTab: openInSidebarTabFor, t }) {
			const projectRoot = projectRootFor(sessionId);
			const inspectChanges = (0, react.useCallback)((request) => inspectChangesFor(sessionId, request), [inspectChangesFor, sessionId]);
			const applyChanges = (0, react.useCallback)((request) => applyChangesFor(sessionId, request), [applyChangesFor, sessionId]);
			const openInSidebarTab = (0, react.useCallback)((paths, turn) => openInSidebarTabFor(sessionId, paths, turn), [openInSidebarTabFor, sessionId]);
			const turnNumber = turnLocation.turn;
			const [toggleAction, setToggleAction] = (0, react.useState)("undo");
			const [statusPending, setStatusPending] = (0, react.useState)(true);
			const [togglePending, setTogglePending] = (0, react.useState)(false);
			const [fileStates, setFileStates] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const [fileBusy, setFileBusy] = (0, react.useState)(null);
			const [toast, setToast] = (0, react.useState)(null);
			const toastSeqRef = (0, react.useRef)(0);
			const [fsReviews, setFsReviews] = (0, react.useState)([]);
			const fsTurnRef = (0, react.useRef)(void 0);
			const lastFsJsonRef = (0, react.useRef)("");
			const startSeq = turnLocation.start?.seq;
			(0, react.useEffect)(() => {
				if (startSeq === void 0 || projectRoot === void 0) {
					fsTurnRef.current = void 0;
					lastFsJsonRef.current = "";
					setFsReviews([]);
					return;
				}
				let active = true;
				const refresh = () => {
					const fsTurn = cachedFsTurnFor(startSeq);
					if (fsTurn === void 0 || fsTurn.turn !== turnNumber) {
						if (lastFsJsonRef.current !== "") {
							lastFsJsonRef.current = "";
							fsTurnRef.current = void 0;
							if (active) setFsReviews([]);
						}
						return;
					}
					const serialized = JSON.stringify(fsTurn);
					if (serialized === lastFsJsonRef.current) return;
					lastFsJsonRef.current = serialized;
					fsTurnRef.current = fsTurn;
					if (active) setFsReviews(fsTurnReviews(fsTurn));
				};
				refresh();
				const unsubscribe = subscribeFsCache(refresh);
				return () => {
					active = false;
					unsubscribe();
				};
			}, [
				startSeq,
				turnNumber,
				projectRoot
			]);
			const reviews = (0, react.useMemo)(() => {
				if (fsReviews.length === 0) return matchedReviews;
				const seen = new Set(matchedReviews.map((review) => review.path));
				return [...matchedReviews, ...fsReviews.filter((review) => !seen.has(review.path))];
			}, [matchedReviews, fsReviews]);
			const [popover, setPopover] = (0, react.useState)(null);
			const cardRef = (0, react.useRef)(null);
			const showTimerRef = (0, react.useRef)(null);
			const hideTimerRef = (0, react.useRef)(null);
			const clearPopoverTimers = (0, react.useCallback)((which) => {
				if ((which === "show" || which === "both") && showTimerRef.current !== null) {
					window.clearTimeout(showTimerRef.current);
					showTimerRef.current = null;
				}
				if ((which === "hide" || which === "both") && hideTimerRef.current !== null) {
					window.clearTimeout(hideTimerRef.current);
					hideTimerRef.current = null;
				}
			}, []);
			(0, react.useEffect)(() => () => {
				clearPopoverTimers("both");
			}, [clearPopoverTimers]);
			const schedulePopoverShow = (0, react.useCallback)((review) => {
				if (review.dir === true) return;
				if (review.diffs.length === 0 && review.origin !== "fs") return;
				clearPopoverTimers("both");
				showTimerRef.current = window.setTimeout(() => {
					const frame = cardRef.current?.getBoundingClientRect();
					if (frame === void 0) return;
					const rect = {
						top: frame.top,
						bottom: frame.bottom,
						left: frame.left,
						width: frame.width
					};
					(async () => {
						let resolved = review;
						if (resolved.diffs.length === 0 && resolved.origin === "fs" && fsTurnRef.current !== void 0 && projectRoot !== void 0) {
							const ensured = await ensureFsFileDiff(fsTurnRef.current, resolved.path, projectRoot);
							if (ensured === null) return;
							resolved = {
								...resolved,
								diffs: ensured.diffs
							};
							setFsReviews((current) => current.map((entry) => entry.path === resolved.path && entry.origin === "fs" ? {
								...entry,
								diffs: ensured.diffs
							} : entry));
						}
						if (resolved.diffs.length === 0) return;
						setPopover({
							review: resolved,
							rect
						});
					})();
				}, 300);
			}, [clearPopoverTimers, projectRoot]);
			const schedulePopoverHide = (0, react.useCallback)(() => {
				clearPopoverTimers("both");
				hideTimerRef.current = window.setTimeout(() => {
					setPopover(null);
				}, 200);
			}, [clearPopoverTimers]);
			const cancelPopoverHide = (0, react.useCallback)(() => {
				clearPopoverTimers("hide");
			}, [clearPopoverTimers]);
			const statsForReview = (0, react.useCallback)((review) => review.counts ?? summarizeDiffs(review.diffs), []);
			const reviewsWithStats = (0, react.useMemo)(() => reviews.map((review) => ({
				review,
				stats: statsForReview(review)
			})), [reviews, statsForReview]);
			const totalStats = (0, react.useMemo)(() => reviewsWithStats.reduce((total, item) => addStats(total, item.stats), {
				added: 0,
				removed: 0
			}), [reviewsWithStats]);
			const inspectFiles = (0, react.useMemo)(() => reviews.filter((review) => review.diffs.length > 0).map((review) => ({
				path: review.path,
				diffs: review.diffs,
				...review.origin !== void 0 ? { origin: review.origin } : {}
			})), [reviews]);
			const reversiblePaths = (0, react.useMemo)(() => new Set(reviews.filter((review) => review.dir === true || review.origin === "fs" && review.diffs.length === 1 && review.diffs[0] !== void 0 && review.diffs[0].path === review.path && review.diffs[0].oldText !== null && review.diffs[0].oldText === review.diffs[0].newText && review.diffs[0].oldMode !== void 0 && review.diffs[0].newMode !== void 0 && review.diffs[0].oldMode !== review.diffs[0].newMode || review.diffs.length > 0 && (review.diffs.length === 1 && review.diffs[0] !== void 0 && review.diffs[0].path === review.path && (review.diffs[0].oldText === null || review.diffs[0].newText === "" && review.diffs[0].oldText !== "") || review.diffs.every((diff) => diff.path === review.path && diff.oldText !== null && diff.oldText !== diff.newText && (diff.oldText !== "" || diff.oldStart !== void 0) && (diff.newText !== "" || diff.newStart !== void 0)))).map((review) => review.path)), [reviews]);
			reversiblePaths.size;
			const hasToggleableFiles = (0, react.useMemo)(() => reviews.some((review) => review.diffs.length > 0 || review.origin === "fs"), [reviews]);
			const allPaths = (0, react.useMemo)(() => reviews.map((review) => review.path), [reviews]);
			const allDeleted = reviews.length > 0 && reviews.every((review) => review.deleted === true);
			const statsMatter = totalStats.added > 0 || totalStats.removed > 0;
			const showToast = (0, react.useCallback)((notice) => {
				toastSeqRef.current += 1;
				setToast({
					seq: toastSeqRef.current,
					...notice
				});
			}, []);
			const phaseForResult = (0, react.useCallback)((result, currentAction) => {
				if (reversiblePaths.size === 0) return "undo";
				const byPath = new Map(result.files.map((file) => [file.path, file]));
				const target = currentAction === "undo" ? "undone" : "applied";
				return [...reversiblePaths].every((path) => byPath.get(path)?.state === target) ? currentAction === "undo" ? "redo" : "undo" : currentAction;
			}, [reversiblePaths]);
			const inspectRef = (0, react.useRef)(inspectChanges);
			inspectRef.current = inspectChanges;
			const inspectKey = (0, react.useMemo)(() => JSON.stringify(inspectFiles), [inspectFiles]);
			const reversibleKey = (0, react.useMemo)(() => [...reversiblePaths].sort().join("\n"), [reversiblePaths]);
			(0, react.useEffect)(() => {
				let active = true;
				if (inspectFiles.length === 0) {
					setFileStates(/* @__PURE__ */ new Map());
					setStatusPending(false);
					return () => {
						active = false;
					};
				}
				setStatusPending(true);
				inspectRef.current({
					action: "undo",
					files: inspectFiles
				}).then((result) => {
					if (!active) return;
					setFileStates(new Map(result.files.map((file) => [file.path, file.state])));
					const allUndone = reversiblePaths.size > 0 && [...reversiblePaths].every((path) => result.files.find((file) => file.path === path)?.state === "undone");
					setToggleAction(allUndone ? "redo" : "undo");
				}).catch(() => {}).finally(() => {
					if (active) setStatusPending(false);
				});
				return () => {
					active = false;
				};
			}, [inspectKey, reversibleKey]);
			const runToggle = (0, react.useCallback)(() => {
				if (statusPending || togglePending || !hasToggleableFiles) return;
				const action = toggleAction;
				setTogglePending(true);
				let requestedPaths = [];
				(async () => {
					const files = [];
					for (const review of reviews) {
						if (review.deleted === true && review.diffs.length === 0 && review.dir !== true) continue;
						if (review.diffs.length > 0) {
							files.push({
								path: review.path,
								diffs: review.diffs,
								...review.origin !== void 0 ? { origin: review.origin } : {},
								...review.dir === true ? { dirKind: review.deleted === true ? "deleted" : "added" } : {}
							});
							continue;
						}
						if (review.origin !== "fs" || fsTurnRef.current === void 0 || projectRoot === void 0) continue;
						const ensured = await ensureFsFileDiff(fsTurnRef.current, review.path, projectRoot);
						if (ensured !== null) files.push({
							path: ensured.path,
							diffs: ensured.diffs,
							origin: "fs",
							...ensured.dir === true ? { dirKind: ensured.deleted === true ? "deleted" : "added" } : {}
						});
					}
					requestedPaths = files.map((file) => file.path);
					return files.length === 0 ? null : applyChanges({
						action,
						files
					});
				})().then((result) => {
					if (result === null) return;
					setFileStates((current) => {
						const next = new Map(current);
						for (const file of result.files) next.set(file.path, file.state);
						return next;
					});
					setToggleAction(phaseForResult(result, action));
					const targetState = action === "undo" ? "undone" : "applied";
					const byPath = new Map(result.files.map((file) => [file.path, file]));
					const failures = requestedPaths.flatMap((path) => {
						if (byPath.get(path)?.state === targetState) return [];
						return [{ path }];
					});
					if (failures.length === 0) {
						showToast({
							tone: "success",
							title: t(action === "undo" ? "produced.undoSuccess" : "produced.redoSuccess"),
							files: []
						});
						return;
					}
					showToast({
						tone: "error",
						title: t(action === "undo" ? "produced.undoPartial" : "produced.redoPartial"),
						description: t(action === "undo" ? "produced.undoPartialDescription" : "produced.redoPartialDescription"),
						files: failures
					});
				}).catch((error) => {
					showToast({
						tone: "error",
						title: t(action === "undo" ? "produced.undoError" : "produced.redoError"),
						description: error instanceof Error ? error.message : String(error),
						files: []
					});
				}).finally(() => {
					setTogglePending(false);
				});
			}, [
				applyChanges,
				hasToggleableFiles,
				phaseForResult,
				projectRoot,
				reviews,
				showToast,
				t,
				statusPending,
				toggleAction,
				togglePending
			]);
			/** 单文件撤销/重新应用：整文件粒度（提交该文件本轮的全部 hunks；hunk 子集
			* 选择只在侧边栏 diff 视图里）。状态来自挂载巡检与每次操作结果，零额外请求。
			* fs 占位条目先按需补齐全文再提交。 */
			const runFileToggle = (0, react.useCallback)((review) => {
				const path = review.path;
				if (statusPending || togglePending || fileBusy !== null) return;
				if (!reversiblePaths.has(path) && review.origin !== "fs") return;
				const action = fileStates.get(path) === "undone" ? "redo" : "undo";
				const target = action === "undo" ? "undone" : "applied";
				setFileBusy(path);
				(async () => {
					let diffs = review.diffs;
					let dirFlag = review.dir === true;
					if (diffs.length === 0) {
						if (review.origin !== "fs" || fsTurnRef.current === void 0 || projectRoot === void 0) return null;
						const ensured = await ensureFsFileDiff(fsTurnRef.current, path, projectRoot);
						if (ensured === null) return null;
						diffs = ensured.diffs;
						dirFlag = ensured.dir === true;
						setFsReviews((current) => current.map((entry) => entry.path === path && entry.origin === "fs" ? {
							...entry,
							diffs: ensured.diffs
						} : entry));
					}
					return applyChanges({
						action,
						files: [{
							path,
							diffs,
							...review.origin !== void 0 ? { origin: review.origin } : {},
							...dirFlag ? { dirKind: review.deleted === true ? "deleted" : "added" } : {}
						}]
					});
				})().then((result) => {
					if (result === null) {
						showToast({
							tone: "error",
							title: t(action === "undo" ? "produced.undoError" : "produced.redoError"),
							files: []
						});
						return;
					}
					const outcome = result.files.find((file) => file.path === path);
					const next = new Map(fileStates);
					next.set(path, outcome?.state ?? "unsupported");
					setFileStates(next);
					const allUndoneNow = reversiblePaths.size > 0 && [...reversiblePaths].every((p) => next.get(p) === "undone");
					setToggleAction(allUndoneNow ? "redo" : "undo");
					if (outcome?.state === target) {
						showToast({
							tone: "success",
							title: t(action === "undo" ? "produced.undoSuccess" : "produced.redoSuccess"),
							files: []
						});
						return;
					}
					showToast({
						tone: "error",
						title: t(action === "undo" ? "produced.undoPartial" : "produced.redoPartial"),
						description: t(action === "undo" ? "produced.undoPartialDescription" : "produced.redoPartialDescription"),
						files: [{ path }]
					});
				}).catch((error) => {
					showToast({
						tone: "error",
						title: t(action === "undo" ? "produced.undoError" : "produced.redoError"),
						description: error instanceof Error ? error.message : String(error),
						files: []
					});
				}).finally(() => {
					setFileBusy(null);
				});
			}, [
				applyChanges,
				fileBusy,
				fileStates,
				projectRoot,
				reversiblePaths,
				showToast,
				t,
				statusPending,
				togglePending
			]);
			const [collapsedDirs, setCollapsedDirs] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const dirTree = (0, react.useMemo)(() => buildDirTree(reviewsWithStats.map((entry) => entry.review.path)), [reviewsWithStats]);
			const itemByPath = (0, react.useMemo)(() => new Map(reviewsWithStats.map((entry) => [entry.review.path, entry])), [reviewsWithStats]);
			const toggleDir = (0, react.useCallback)((dirPath) => {
				setCollapsedDirs((current) => {
					const next = new Set(current);
					if (next.has(dirPath)) next.delete(dirPath);
					else next.add(dirPath);
					return next;
				});
			}, []);
			const renderFileLeaf = (review, stats, depth) => {
				const reversible = reversiblePaths.has(review.path);
				const fileAction = fileStates.get(review.path) === "undone" ? "redo" : "undo";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProducedFiles_module_css_default.fileRow,
					title: review.path,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ProducedFiles_module_css_default.fileLink,
						"aria-label": t("produced.review", { name: review.path }),
						onMouseEnter: () => {
							schedulePopoverShow(review);
						},
						onMouseLeave: schedulePopoverHide,
						onFocus: () => {
							schedulePopoverShow(review);
						},
						onBlur: schedulePopoverHide,
						onClick: () => {
							setPopover(null);
							clearPopoverTimers("both");
							openInSidebarTab?.([review.path], turnNumber);
						},
						children: [
							depth > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.dirIndent,
								"aria-hidden": "true",
								style: { width: depth * 14 }
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.fileName,
								children: basename(review.path)
							}),
							review.deleted === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.deletedBadge,
								children: t("produced.deleted")
							}) : review.dir === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.deletedBadge,
								children: t("produced.dir")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatBar, { stats }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats, {
								stats,
								label: t("review.stats", {
									added: String(stats.added),
									removed: String(stats.removed)
								})
							})] })
						]
					}), (review.deleted !== true || review.diffs.length > 0 || review.dir === true) && (reversible || review.origin === "fs") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ProducedFiles_module_css_default.fileUndoButton,
						disabled: statusPending || togglePending || fileBusy !== null,
						"aria-label": t(fileAction === "undo" ? "produced.undoFile" : "produced.redoFile"),
						title: t(fileAction === "undo" ? "produced.undoFile" : "produced.redoFile"),
						onClick: () => {
							runFileToggle(review);
						},
						children: fileAction === "undo" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileUndoIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileRedoIcon, {})
					})]
				}, review.path);
			};
			const renderDirNodes = (nodes, depth) => nodes.flatMap((node) => {
				if (node.children === void 0) {
					const item = itemByPath.get(node.path);
					return item === void 0 ? [] : [renderFileLeaf(item.review, item.stats, depth)];
				}
				const isCollapsed = collapsedDirs.has(node.path);
				return [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ProducedFiles_module_css_default.dirRow,
					onClick: () => {
						toggleDir(node.path);
					},
					"aria-expanded": !isCollapsed,
					children: [
						depth > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.dirIndent,
							"aria-hidden": "true",
							style: { width: depth * 14 }
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.dirToggle,
							children: isCollapsed ? "▸" : "▾"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ProducedFiles_module_css_default.dirName,
							children: [node.name, "/"]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.dirCount,
							children: String(countLeafFiles(node.children))
						})
					]
				}, `dir:${node.path}`), ...isCollapsed ? [] : renderDirNodes(node.children, depth + 1)];
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					ref: cardRef,
					className: ProducedFiles_module_css_default.card,
					"aria-label": t("produced.summary"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ProducedFiles_module_css_default.cardHeader,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProducedFiles_module_css_default.fileIconWrap,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProducedFiles_module_css_default.cardTitleBlock,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ProducedFiles_module_css_default.cardTitle,
										children: allDeleted ? reviews.length === 1 ? t("produced.deletedOne") : t("produced.deletedAll", { count: String(reviews.length) }) : reviews.length === 1 ? t("produced.editedOne") : t("produced.edited", { count: String(reviews.length) })
									}),
									statsMatter && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats, {
										stats: totalStats,
										label: t("review.stats", {
											added: String(totalStats.added),
											removed: String(totalStats.removed)
										})
									}),
									statsMatter && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatBar, { stats: totalStats })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ProducedFiles_module_css_default.toggleButton,
								disabled: statusPending || togglePending || !hasToggleableFiles,
								title: !hasToggleableFiles ? t("produced.toggleUnavailable") : void 0,
								"aria-label": toggleAction === "undo" ? t("produced.undo") : t("produced.redo"),
								onClick: runToggle,
								children: togglePending ? toggleAction === "undo" ? t("produced.undoing") : t("produced.redoing") : toggleAction === "undo" ? t("produced.undo") : t("produced.redo")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ProducedFiles_module_css_default.reviewButton,
								"aria-label": t("produced.reviewAll"),
								onClick: () => {
									openInSidebarTab?.(allPaths, turnNumber);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReviewIcon, {}), t("review.title")]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ProducedFiles_module_css_default.fileList,
						children: renderDirNodes(dirTree, 0)
					})]
				}),
				popover !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffPopover, {
					review: popover.review,
					anchor: popover.rect,
					stats: summarizeDiffs(popover.review.diffs),
					statsLabel: t("review.stats", {
						added: String(summarizeDiffs(popover.review.diffs).added),
						removed: String(summarizeDiffs(popover.review.diffs).removed)
					}),
					t,
					onEnter: cancelPopoverHide,
					onLeave: schedulePopoverHide
				}),
				toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultToast, {
					notice: toast,
					closeLabel: t("produced.noticeClose"),
					dismissLabel: t("produced.noticeDismiss"),
					fileListLabel: t("produced.skippedFiles", { count: String(toast.files.length) }),
					fileOpenLabel: (path) => t("produced.open", { name: basename(path) }),
					openFile,
					onDone: () => {
						setToast((current) => current?.seq === toast.seq ? null : current);
					}
				}, toast.seq)
			] });
		}
		//#endregion
		//#region src/client/live-bar.tsx
		/**
		* LiveChangesBar —— 轮中 live 条：正在进行的那一轮的文件变更实时读数，
		* 注册在 `conversation.input.dock`（输入卡上方那一行座位）。
		*
		* 两个数据源在这里合流：工具侧的改动直接来自会话快照（`deriveSessionChanges`
		* 的 live 轮），终端 / PowerShell 写盘来自 warm 过的 fs-changes 缓存
		* （live-tail 条目）。回合空闲或没有任何改动时渲染空——轮结束后由轮尾卡片
		* 接手。
		*
		* 交互契约与轮尾卡片完全一致：文件列表最多露四行、超出滚动；悬停某行弹出
		* 与本框对齐的共用 DiffPopover；点击某行在侧边栏打开该文件的审计。
		*/
		let sessionsRef;
		let openSidebarRef;
		/** 由 applyFileReview 调用一次，让 live 条能解析出会话工作区目录。 */
		function bindLiveBarSessions(sessions) {
			sessionsRef = sessions;
		}
		/** 由 applyFileReview 调用一次，让点击行能在侧边栏打开审计。 */
		function bindLiveBarOpenSidebar(opener) {
			openSidebarRef = opener;
		}
		/** 读会话 cwd；绑定缺席时返回 undefined（调用方一律当作「无法解析」处理）。 */
		function liveBarCwd(sessionId) {
			return sessionsRef?.list.getSnapshot().byId[sessionId]?.cwd;
		}
		function LiveChangesBar({ session, sessionId, useChat, t }) {
			const chat = useChat((value) => value);
			const id = String(sessionId);
			const cwd = liveBarCwd(id);
			const [cacheTick, setCacheTick] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				warmFsChanges(id);
			}, [
				session,
				chat,
				id
			]);
			(0, react.useEffect)(() => subscribeFsCache(() => {
				setCacheTick((value) => value + 1);
			}), []);
			const liveTurn = (0, react.useMemo)(() => deriveSessionChanges(chat), [chat]).find((turn) => turn.live);
			const liveTurnNumber = liveTurn?.turn;
			const fsReviews = (0, react.useMemo)(() => {
				if (liveTurnNumber === void 0) return [];
				const fsTurn = cachedFsTurnForSessionTurn(sessionId, liveTurnNumber);
				return fsTurn === void 0 ? [] : fsTurnReviews(fsTurn);
			}, [
				liveTurnNumber,
				sessionId,
				cacheTick
			]);
			const [popover, setPopover] = (0, react.useState)(null);
			const barRef = (0, react.useRef)(null);
			const showTimerRef = (0, react.useRef)(null);
			const hideTimerRef = (0, react.useRef)(null);
			const clearTimers = (0, react.useCallback)((which) => {
				if ((which === "show" || which === "both") && showTimerRef.current !== null) {
					window.clearTimeout(showTimerRef.current);
					showTimerRef.current = null;
				}
				if ((which === "hide" || which === "both") && hideTimerRef.current !== null) {
					window.clearTimeout(hideTimerRef.current);
					hideTimerRef.current = null;
				}
			}, []);
			(0, react.useEffect)(() => () => {
				clearTimers("both");
			}, [clearTimers]);
			const scheduleShow = (0, react.useCallback)((review) => {
				if (review.dir === true) return;
				if (review.diffs.length === 0 && review.origin !== "fs") return;
				clearTimers("both");
				showTimerRef.current = window.setTimeout(() => {
					const frame = barRef.current?.getBoundingClientRect();
					if (frame === void 0) return;
					const rect = {
						top: frame.top,
						bottom: frame.bottom,
						left: frame.left,
						width: frame.width
					};
					(async () => {
						let resolved = review;
						if (resolved.diffs.length === 0 && resolved.origin === "fs" && cwd !== void 0) {
							const fsTurn = cachedFsTurnForSessionTurn(sessionId, liveTurnNumber ?? -1);
							if (fsTurn === void 0) return;
							const ensured = await ensureFsFileDiff(fsTurn, resolved.path, cwd);
							if (ensured === null) return;
							resolved = {
								...resolved,
								diffs: ensured.diffs
							};
						}
						if (resolved.diffs.length === 0) return;
						setPopover({
							review: resolved,
							rect
						});
					})();
				}, 300);
			}, [
				clearTimers,
				cwd,
				sessionId,
				liveTurnNumber
			]);
			const scheduleHide = (0, react.useCallback)(() => {
				clearTimers("both");
				hideTimerRef.current = window.setTimeout(() => {
					setPopover(null);
				}, 200);
			}, [clearTimers]);
			const cancelHide = (0, react.useCallback)(() => {
				clearTimers("hide");
			}, [clearTimers]);
			if (liveTurn === void 0) return null;
			const statsFor = (file) => file.counts ?? summarizeDiffs(file.diffs);
			const seen = new Set(liveTurn.files.map((file) => file.path));
			const merged = [...liveTurn.files, ...fsReviews.filter((file) => !seen.has(file.path))];
			if (merged.length === 0) return null;
			const stats = merged.reduce((total, file) => {
				const own = statsFor(file);
				return {
					added: total.added + own.added,
					removed: total.removed + own.removed
				};
			}, {
				added: 0,
				removed: 0
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: barRef,
				className: ProducedFiles_module_css_default.liveBar,
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProducedFiles_module_css_default.liveBarHeader,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.liveDot,
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProducedFiles_module_css_default.liveTitle,
							children: t("live.changes", { count: String(merged.length) })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ProducedFiles_module_css_default.stats,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ProducedFiles_module_css_default.added,
								children: ["+", stats.added]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ProducedFiles_module_css_default.removed,
								children: ["-", stats.removed]
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ProducedFiles_module_css_default.liveFiles,
					children: merged.map((file) => {
						const own = statsFor(file);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ProducedFiles_module_css_default.liveFileRow,
							title: file.path,
							onMouseEnter: () => {
								scheduleShow(file);
							},
							onMouseLeave: scheduleHide,
							onFocus: () => {
								scheduleShow(file);
							},
							onBlur: scheduleHide,
							onClick: () => {
								setPopover(null);
								clearTimers("both");
								openSidebarRef?.(sessionId, [file.path], liveTurn.turn);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.fileName,
									children: basename(file.path)
								}),
								file.deleted === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProducedFiles_module_css_default.deletedBadge,
									children: t("live.deleted")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ProducedFiles_module_css_default.stats,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ProducedFiles_module_css_default.added,
										children: ["+", own.added]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ProducedFiles_module_css_default.removed,
										children: ["-", own.removed]
									})]
								})
							]
						}, file.path);
					})
				})]
			}), popover !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffPopover, {
				review: popover.review,
				anchor: popover.rect,
				stats: summarizeDiffs(popover.review.diffs),
				statsLabel: t("review.stats", {
					added: String(summarizeDiffs(popover.review.diffs).added),
					removed: String(summarizeDiffs(popover.review.diffs).removed)
				}),
				t,
				onEnter: cancelHide,
				onLeave: scheduleHide
			})] });
		}
		//#endregion
		//#region src/client/chat-locales.ts
		/**
		* 聊天面（`file-review` 命名空间）的 zh / en 字典。
		*
		* 英文是键集的唯一真相来源：添加文案必须先动 `en`，再补 `zh`——缺键时
		* `t()` 回落到英文，反过来则会裸露键名给用户看。
		*/
		/** 本插件在 DSH 语言注册表里拥有的字典命名空间。 */
		const NS = "file-review";
		/** 英文字典（键集的唯一真相来源）。 */
		const en = {
			"produced.summary": "Edited files",
			"produced.editedOne": "Edited 1 file",
			"produced.edited": "Edited {count} files",
			"produced.moreOne": "1 more file",
			"produced.more": "{count} more files",
			"produced.open": "Open {name}",
			"produced.review": "Review {name}",
			"produced.reviewAll": "Review all produced files",
			"produced.undo": "Undo",
			"produced.redo": "Reapply",
			"produced.undoFile": "Undo this file's changes",
			"produced.redoFile": "Reapply this file's changes",
			"produced.undoing": "Undoing…",
			"produced.redoing": "Reapplying…",
			"produced.toggleUnavailable": "No safely reversible files are available in this change",
			"produced.undoSuccess": "Changes undone",
			"produced.redoSuccess": "Changes reapplied",
			"produced.undoPartial": "Not all changes were restored",
			"produced.redoPartial": "Not all changes were reapplied",
			"produced.undoPartialDescription": "An error occurred while restoring some files",
			"produced.redoPartialDescription": "An error occurred while reapplying some files",
			"produced.skippedFiles": "Skipped ({count})",
			"produced.undoError": "Could not undo changes",
			"produced.redoError": "Could not reapply changes",
			"produced.noticeClose": "Dismiss notification",
			"produced.noticeDismiss": "Close",
			"produced.deleted": "deleted",
			"produced.dir": "directory",
			"produced.deletedOne": "Deleted 1 file",
			"produced.deletedAll": "Deleted {count} files",
			"review.title": "Review",
			"review.fileOne": "1 file",
			"review.files": "{count} files",
			"review.close": "Close",
			"review.resize": "Resize review panel",
			"review.resizeHint": "Drag to resize. Double-click to reset.",
			"review.openInEditor": "Open in editor",
			"review.copy": "Copy diff",
			"review.copied": "Copied",
			"review.showUnchanged": "{count} unchanged lines",
			"review.hideUnchanged": "Hide {count} unchanged lines",
			"review.hunkN": "Hunk {n}",
			"review.hunkInclude": "Include this hunk in undo/reapply",
			"review.stats": "{added} lines added, {removed} lines removed",
			"review.unavailable": "No reconstructable diff is available for this change. You can still open the current file.",
			"live.changes": "{count} files changed this turn",
			"live.deleted": "deleted",
			"live.more": "{count} more"
		};
		/** 简体中文字典（`Record` 约束保证与英文键集一一对应，漏翻即编译报错）。 */
		const zh = {
			"produced.summary": "已编辑文件",
			"produced.editedOne": "已编辑 1 个文件",
			"produced.edited": "已编辑 {count} 个文件",
			"produced.moreOne": "另有 1 个文件",
			"produced.more": "另有 {count} 个文件",
			"produced.open": "打开 {name}",
			"produced.review": "审查 {name}",
			"produced.reviewAll": "审查所有产出文件",
			"produced.undo": "撤销",
			"produced.redo": "重新应用",
			"produced.undoFile": "撤销此文件的改动",
			"produced.redoFile": "重新应用此文件的改动",
			"produced.undoing": "正在撤销…",
			"produced.redoing": "正在重新应用…",
			"produced.toggleUnavailable": "本次更改中没有可安全还原的文件",
			"produced.undoSuccess": "已成功撤销更改",
			"produced.redoSuccess": "已成功重新应用更改",
			"produced.undoPartial": "未还原全部更改",
			"produced.redoPartial": "未重新应用全部更改",
			"produced.undoPartialDescription": "还原部分文件时出错",
			"produced.redoPartialDescription": "重新应用部分文件时出错",
			"produced.skippedFiles": "已跳过（{count} 个）",
			"produced.undoError": "未能撤销更改",
			"produced.redoError": "未能重新应用更改",
			"produced.noticeClose": "关闭提示",
			"produced.noticeDismiss": "关闭",
			"produced.deleted": "已删除",
			"produced.dir": "目录",
			"produced.deletedOne": "已删除 1 个文件",
			"produced.deletedAll": "已删除 {count} 个文件",
			"review.title": "审查",
			"review.fileOne": "1 个文件",
			"review.files": "{count} 个文件",
			"review.close": "关闭",
			"review.resize": "调整审查面板大小",
			"review.resizeHint": "拖动以调整大小。双击恢复默认大小。",
			"review.openInEditor": "在编辑器中打开",
			"review.copy": "复制差异",
			"review.copied": "已复制",
			"review.showUnchanged": "显示 {count} 行未更改内容",
			"review.hideUnchanged": "隐藏 {count} 行未更改内容",
			"review.hunkN": "块 {n}",
			"review.hunkInclude": "将此块纳入撤销/重新应用",
			"review.stats": "新增 {added} 行，删除 {removed} 行",
			"review.unavailable": "无法为此更改还原可审查的差异。你仍可打开当前文件。",
			"live.changes": "本轮已更改 {count} 个文件",
			"live.deleted": "已删除",
			"live.more": "另有 {count} 个"
		};
		//#endregion
		//#region src/client/status-dedupe.ts
		const inflight = /* @__PURE__ */ new Map();
		/** 请求签名：路径 + 两侧文本 + 行锚点全文参与（仅 in-flight 存活，即用即弃）。 */
		function requestKey(sessionId, request) {
			return JSON.stringify([
				sessionId,
				request.action,
				request.files
			]);
		}
		function dedupeStatus(sessionId, request, invoke) {
			const key = requestKey(sessionId, request);
			const existing = inflight.get(key);
			if (existing !== void 0) return existing;
			const task = invoke(request).finally(() => {
				inflight.delete(key);
			});
			inflight.set(key, task);
			return task;
		}
		//#endregion
		//#region src/client/file-review.tsx
		/**
		* 带文件系统感知的轮尾认领：工具产出的审查照旧认领；而一轮的写盘只发生在
		* 工具之外（PowerShell 等）时，只要 warm 过的 fs-changes 缓存已经知道该轮
		* （键是每会话唯一的 turn/start seq），就用**空 match** 认领——挂载后的卡片
		* 自行拉取内容填满自己。select() 是同步的，异步端点的结果只能经由这个缓存
		* 抵达。
		*/
		function selectProducedFilesWithFs(owner) {
			const reviews = selectProducedFiles(owner);
			if (reviews !== null) return reviews;
			const startSeq = owner.turn.start?.seq;
			if (startSeq !== void 0 && cachedFsTurnFor(startSeq)?.turn === owner.turn.turn) return [];
			return null;
		}
		/** Tab 图标：按宿主给的大小画的一个朴素行 diff 字形。 */
		function FileReviewIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M11.25 2.75v3.5h3.5" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7 10h2.5M10.5 10H12M7 13h5" })
				]
			});
		}
		/**
		* Tab 条徽标：本会话改过的不重复文件数。
		* 侧边栏的 tab 条几乎总在重渲染（而且事件流每个事件都发布新快照引用），所以
		* 推导结果按每会话一个廉价的**结构指纹**记忆化——token 流刷新时指纹保持稳定，
		* 直接跳过完整重推导。
		*/
		const badgeMemo = /* @__PURE__ */ new Map();
		function snapshotFingerprint(snapshot) {
			if (snapshot === null) return "none";
			const legacy = snapshot.legacy;
			let lastEnd = 0;
			for (const endSeq of legacy.turnEnds.values()) lastEnd = endSeq;
			return `${legacy.nodes.length}:${legacy.turnEnds.size}:${lastEnd}`;
		}
		/**
		* Read a cordis service without the inject requirement（新版 cordis 走
		* `ctx.get`，旧版回落 reflect.get）。
		*/
		function getService(ctx, name) {
			const anyCtx = ctx;
			if (typeof anyCtx.get === "function") return anyCtx.get(name);
			return ctx.reflect.get(name);
		}
		/**
		* Resolve one session's Chat target snapshot（dsh 0.1.2：会话变更推导的数据
		* 源从 runtime 会话快照换成 uiConversation 会话绑定的 `chat` 视图快照）。
		* uiConversation 缺失（未装配的宿主）返回 null——徽标降级为空。
		*/
		function resolveChatSnapshot(ctx, sessionId) {
			return (getService(ctx, "uiConversation")?.binding?.(sessionId))?.target?.("chat")?.getSnapshot?.() ?? null;
		}
		function badgeCount(ctx, sessionId) {
			warmFsChanges(sessionId);
			ctx.sessions.binding(sessionId);
			const snapshot = resolveChatSnapshot(ctx, sessionId);
			const fingerprint = snapshotFingerprint(snapshot);
			const hit = badgeMemo.get(sessionId);
			if (hit !== void 0 && hit.fingerprint === fingerprint) return hit.count;
			const count = countChangedFiles(deriveSessionChanges(snapshot));
			const value = count === 0 ? null : count;
			badgeMemo.set(sessionId, {
				fingerprint,
				count: value
			});
			return value;
		}
		/**
		* 不静态注入、动态解析 conversation Definition 注册表。
		* dsh 0.1.2-alpha.1+ 把旧的 `conversationEvents` / `conversationViews` 对折
		* 进单一 `uiConversation` 服务（注册表在其 `.events` 属性上）；dsh 0.1.1 及
		* 更早则暴露为独立的根 `conversationEvents` 服务。运行的 dsh 两者都不提供时
		* 返回 undefined——调用方优雅降级而非阻塞。
		*/
		function resolveConversationEvents(ctx) {
			const uiConversation = getService(ctx, "uiConversation");
			if (uiConversation?.events !== void 0 && uiConversation.events !== null) return uiConversation.events;
			const conversationEvents = getService(ctx, "conversationEvents");
			if (conversationEvents !== void 0 && conversationEvents !== null) return conversationEvents;
		}
		/**
		* 不静态注入、动态解析 better-sidebar 注册表：`betterSidebar` 只由**可选**的
		* dsh-better-sidebar 插件发布，而本插件必须能在没有它的宿主上启动
		* （rewind / live 条 / 轮尾行都能独立运行）。插件缺席时返回 undefined——每个
		* 调用方都优雅降级而非阻塞。
		*/
		function resolveBetterSidebar(ctx) {
			const sidebar = getService(ctx, "betterSidebar");
			if (sidebar === void 0 || sidebar === null) return void 0;
			return sidebar;
		}
		/**
		* 客户端插件主体：挂 locale、装载 Typert remote、注册聊天轮尾行与侧边栏 tab。
		* @param ctx - 客户端根上下文。
		*/
		function applyFileReview(ctx) {
			attachLocale(ctx.locale);
			ctx.effect(() => {
				const offZh = ctx.locale.register(LOCALE_NS, "zh", zh$1);
				const offEn = ctx.locale.register(LOCALE_NS, "en", en$1);
				return () => {
					offZh();
					offEn();
				};
			}, "shadow-rewind: tab dictionaries");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "shadow-rewind: chat dictionaries");
			ctx.effect(() => {
				let disposed = false;
				let disposeRemote;
				ctx.remote.$mount(TYPERT_REMOTE).then((dispose) => {
					if (disposed) dispose();
					else disposeRemote = dispose;
				}).catch((error) => {
					console.error("[dsh-shadow-rewind] remote mount error:", error);
				});
				return () => {
					disposed = true;
					if (disposeRemote !== void 0) disposeRemote();
				};
			}, "shadow-rewind: typert remote");
			let registeredOn;
			const registerDeliverables = () => {
				const events = resolveConversationEvents(ctx);
				if (events === void 0 || events === registeredOn) return;
				registeredOn = events;
				ctx.effect(() => events.register(deliverablesDefinition), "shadow-rewind: deliverables definition");
			};
			registerDeliverables();
			ctx.on("internal/service", (name) => {
				if (name === "conversationEvents" || name === "uiConversation") registerDeliverables();
			});
			ctx.effect(() => ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: selectProducedFilesWithFs,
				priority: -2,
				locale: NS,
				registrant: "dsh-shadow-rewind",
				inject: () => {
					const sessions = ctx.sessions;
					const projectRootFor = (id) => sessions.list.getSnapshot().byId[id]?.cwd;
					const invoke = async (id, method, request) => {
						const scope = sessions.scope(id);
						if (scope === void 0) throw new Error("Session is unavailable");
						const fileReview = scope.remote.fileReview;
						if (fileReview === void 0) throw new Error("File review Remote is unavailable");
						const result = await fileReview[method](request);
						if (!result.ok) throw new Error(result.error.message);
						return result.value;
					};
					return {
						projectRootFor,
						inspectChanges: (id, request) => dedupeStatus(id, request, (bound) => invoke(id, "status", bound)),
						applyChanges: (id, request) => invoke(id, "apply", request),
						openInSidebarTab: (id, paths, turn) => {
							const sidebar = resolveBetterSidebar(ctx);
							const first = paths[0];
							if (sidebar === void 0 || first === void 0) return;
							const meta = {
								expandPaths: [...paths],
								...turn !== void 0 ? { turn } : {}
							};
							const projectRoot = projectRootFor(id);
							const scope = {
								sessionId: id,
								...projectRoot !== void 0 ? { cwd: projectRoot } : {}
							};
							sidebar.updateTab("file-review", { meta });
							sidebar.openTab({
								type: "file-review",
								path: first,
								meta
							}, scope);
							sidebar.activateTab("file-review", scope);
						}
					};
				}
			}, ProducedFiles)), "shadow-rewind: turn-tail row");
			bindLiveBarSessions(ctx.sessions);
			bindLiveBarOpenSidebar((sessionId, paths, turn) => {
				const sidebar = resolveBetterSidebar(ctx);
				const first = paths[0];
				if (sidebar === void 0 || first === void 0) return;
				const projectRoot = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
				const meta = {
					expandPaths: [...paths],
					...turn !== void 0 ? { turn } : {}
				};
				const scope = {
					sessionId,
					...projectRoot !== void 0 ? { cwd: projectRoot } : {}
				};
				sidebar.updateTab("file-review", { meta });
				sidebar.openTab({
					type: "file-review",
					path: first,
					meta
				}, scope);
				sidebar.activateTab("file-review", scope);
			});
			ctx.effect(() => ctx.slots.register({
				name: "conversation.input.dock",
				id: "shadow-rewind-live",
				locale: NS,
				registrant: "dsh-shadow-rewind"
			}, LiveChangesBar), "shadow-rewind: live changes bar");
			ctx.effect(() => {
				const tChat = ctx.locale.bind(NS);
				return ctx.provide("chatFileMentions", { forClosing(owner) {
					const reviews = selectProducedFiles(owner);
					if (reviews === null) return void 0;
					return producedFileMentions(reviews.map((review) => review.path), owner.openFile, (path) => tChat("produced.open", { name: path }));
				} });
			}, "shadow-rewind: chat file mentions");
			let tabRegisteredOn;
			const registerSidebarTab = () => {
				const sidebar = resolveBetterSidebar(ctx);
				if (sidebar === void 0 || sidebar === tabRegisteredOn) return;
				tabRegisteredOn = sidebar;
				ctx.effect(() => sidebar.registerTab({
					id: "file-review",
					title: () => t("tabTitle"),
					icon: (size) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileReviewIcon, { size }),
					order: 35,
					single: true,
					badge: (badgeCtx, scope) => badgeCount(badgeCtx, scope.sessionId),
					component: ({ ctx: tabCtx, scope, visible, tab }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileReviewTab, {
						ctx: tabCtx,
						sessionId: scope.sessionId,
						cwd: scope.cwd,
						visible,
						tab
					})
				}), "shadow-rewind: register tab");
			};
			registerSidebarTab();
			ctx.on("internal/service", (name) => {
				if (name === "betterSidebar") registerSidebarTab();
			});
		}
		//#endregion
		//#region src/client/rewind.ts
		/**
		* dsh-shadow-rewind —— 浏览器半边的「会话回退」面。
		* （自手写 client.js 等价移植为 TS 模块，行为与文案保持逐行一致。）
		*
		* 职责：给每条直发用户消息挂「恢复到发送之前」入口，打开预览对话框
		* （文件清单 / 快照跳过项 / 两种回退模式），确认后调用宿主 /shadow-rewind
		* 端点执行文件恢复，可选在分叉出的新会话里继续。
		*
		* 全部走客户端公开服务（slots / sessions / conversation），宿主半边不注入
		* 任何上下文；文件恢复的真正执行与安全闸都在引擎侧。
		*/
		const PATH$1 = "/shadow-rewind";
		const STYLE_ID$1 = "dsh-shadow-rewind";
		const styles$1 = `
.srw-tail{display:inline-flex;align-items:center;align-self:center;height:24px;margin-left:2px}
.srw-trigger{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.srw-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.srw-overlay{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.55);backdrop-filter:blur(4px)}
.srw-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:min(560px,100%);max-height:calc(100dvh - 96px);padding:18px 20px;border-radius:14px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#111a2e);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));box-shadow:0 18px 60px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e6ecff)}
.srw-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:600}
.srw-foot{display:flex;justify-content:flex-end;gap:8px}
.srw-foot button{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-secondary,#b8c5ea);cursor:pointer;font-size:13px}
.srw-foot button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.srw-foot button:disabled{opacity:.5;cursor:default}
.srw-content{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.srw-body{display:flex;flex-direction:column;gap:14px;width:100%;min-width:0;box-sizing:border-box}
.srw-option{display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.srw-option[data-selected="true"]{border-color:var(--dsw-alias-state-business-primary)}
.srw-option input{flex:none;margin:2px 0 0}
.srw-option-content{flex:1;min-width:0}
.srw-option strong{display:block;color:var(--dsw-alias-label-primary);font-size:14px}
.srw-option-description{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.srw-summary{display:flex;flex-wrap:wrap;column-gap:16px;row-gap:4px;color:var(--dsw-alias-label-secondary);font-size:13px}
.srw-files{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.srw-file{display:flex;justify-content:space-between;gap:16px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.srw-file[data-expandable="true"]{cursor:pointer}
.srw-file[data-expandable="true"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-file-diff{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:300px;overflow:auto;background:var(--dsw-alias-bg-layer-2)}
.srw-file:last-child{border-bottom:0}
.srw-file code{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.srw-kind{flex:none;color:var(--dsw-alias-label-tertiary)}
.srw-skipped{margin:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.srw-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.srw-warning,.srw-error{margin:0;padding:10px 12px;border-radius:10px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.srw-warning{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}
.srw-error{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);color:var(--dsw-alias-state-error-primary)}
.srw-retry{align-self:flex-start}
.srw-select-all{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.srw-file input[type="checkbox"]{flex:none;cursor:pointer}
`;
		function rewindApply(ctx) {
			ctx.effect(() => {
				if (document.querySelector(`style[data-plugin-css="${STYLE_ID$1}"]`) !== null) return () => {};
				const tag = document.createElement("style");
				tag.dataset.plugin = STYLE_ID$1;
				tag.dataset.pluginCss = STYLE_ID$1;
				tag.textContent = styles$1;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "shadow-rewind: styles");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "shadow-rewind-portals",
				order: 100,
				inject: () => ({ openRestoredSession: async (sessionId, promptText) => {
					await openSessionWithDraft(ctx, sessionId, promptText);
				} })
			}, RewindPortals));
		}
		/** 从一条会话节点提取「可回退的直发用户消息」锚点。 */
		function selectRewindMessage(node) {
			if (node.kind !== "user" || !Number.isSafeInteger(node.seq) || node.seq < 0) return null;
			const promptText = (Array.isArray(node.content) ? node.content : []).filter((block) => typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
			return {
				messageSeq: node.seq,
				promptText
			};
		}
		function RewindPortals({ sessionId, openRestoredSession, useSession }) {
			const nodes = useSession((snapshot) => nodesOf(snapshot));
			const [targets, setTargets] = react.useState([]);
			react.useLayoutEffect(() => {
				let active = true;
				let queued = false;
				const refresh = () => {
					if (!active) return;
					const next = collectTargets(nodes);
					setTargets((current) => sameTargets(current, next) ? current : next);
				};
				const queue = () => {
					if (queued || !active) return;
					queued = true;
					queueMicrotask(() => {
						queued = false;
						refresh();
					});
				};
				refresh();
				const observer = new MutationObserver(queue);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					active = false;
					observer.disconnect();
				};
			}, [nodes]);
			return targets.map((target) => react.createElement(RewindAction, {
				key: `${sessionId}:${String(target.matched.messageSeq)}`,
				matched: target.matched,
				container: target.container,
				sessionId,
				openRestoredSession
			}));
		}
		/** 兼容不同 dsh 版本的快照形态：优先 chat.nodes（Map），回退顶层 nodes。 */
		function nodesOf(snapshot) {
			if (typeof snapshot !== "object" || snapshot === null) return [];
			const record = snapshot;
			return record.chat?.nodes?.values() ?? record.nodes ?? [];
		}
		function RewindAction({ matched, container, sessionId, openRestoredSession }) {
			const [open, setOpen] = react.useState(false);
			return react.createElement(react.Fragment, null, createPortalButton(container, matched, () => setOpen(true)), open && react.createElement(RewindDialog, {
				sessionId,
				matched,
				openRestoredSession,
				onClose: () => setOpen(false)
			}));
		}
		/** 往消息操作行尾部注入回退按钮（命令式 DOM，与宿主列表结构解耦）。 */
		function createPortalButton(container, _matched, onOpen) {
			let holder = container.querySelector(":scope > .srw-tail");
			if (holder === null) {
				holder = document.createElement("span");
				holder.className = "srw-tail";
				const button = document.createElement("button");
				button.type = "button";
				button.className = "srw-trigger";
				button.title = "恢复到发送这条消息之前";
				button.setAttribute("aria-label", "恢复到发送这条消息之前");
				button.innerHTML = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6.35 3.25 2.75 7l3.6 3.75M3.1 7h5.15a4.25 4.25 0 0 1 4.25 4.25v1.25\" stroke=\"currentColor\" stroke-width=\"1.45\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
				button.addEventListener("click", (event) => {
					event.stopPropagation();
					event.preventDefault();
					onOpen();
				});
				holder.appendChild(button);
				container.appendChild(holder);
			}
			return null;
		}
		function RewindDialog({ sessionId, matched, openRestoredSession, onClose }) {
			const [loading, setLoading] = react.useState(true);
			const [preview, setPreview] = react.useState(null);
			const [mode, setMode] = react.useState("both");
			const [applying, setApplying] = react.useState(false);
			const [stale, setStale] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [completed, setCompleted] = react.useState(null);
			const [undoing, setUndoing] = react.useState(false);
			const [selected, setSelected] = react.useState(null);
			const load = react.useCallback(async (silent = false) => {
				if (!silent) {
					setLoading(true);
					setStale(false);
					setError(null);
					setCompleted(null);
				}
				try {
					const first = decodePreview(await responseJson(await fetch(`${PATH$1}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}`, {
						headers: { accept: "application/json" },
						cache: "no-store"
					})));
					if (first.status === "ready" && first.mode === "symmetric" && first.truncated) {
						const collected = [...first.changes];
						let offset = collected.length;
						while (first.totalChanges > offset) {
							const page = decodePreview(await responseJson(await fetch(`${PATH$1}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}&details=1&offset=${String(offset)}&limit=200`, {
								headers: { accept: "application/json" },
								cache: "no-store"
							})));
							if (page.status !== "ready" || page.checkpointId !== first.checkpointId || page.offset !== offset) throw new RewindRequestError("PLAN_STALE", "项目文件在展开列表时发生了变化。");
							collected.push(...page.changes);
							offset += page.changes.length;
							if (page.changes.length === 0) break;
						}
						const merged = {
							...first,
							changes: collected,
							truncated: false
						};
						setPreview(merged);
						setSelected(new Set(merged.changes.filter((change) => change.autoSelect === true).map((change) => change.path)));
						return;
					}
					setPreview(first);
					setSelected(first.status === "ready" && first.mode === "symmetric" ? new Set(first.changes.filter((change) => change.autoSelect === true).map((change) => change.path)) : null);
				} catch (caught) {
					if (!silent) setError(friendlyError(caught));
				} finally {
					if (!silent) setLoading(false);
				}
			}, [sessionId, matched.messageSeq]);
			react.useEffect(() => {
				load();
			}, [load]);
			const ready = preview !== null && preview.status === "ready" ? preview : null;
			const hasChanges = ready !== null && ready.totalChanges > 0;
			const sharedBlocked = ready !== null && (ready.restoreBlocked ?? ready.activeSessionIds.length > 0);
			react.useEffect(() => {
				if (!sharedBlocked || applying || completed !== null) return;
				const timer = window.setInterval(() => {
					load(true);
				}, 3e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [
				sharedBlocked,
				applying,
				completed,
				load
			]);
			const gatedRunning = ready?.gatedSessionIds?.length ?? 0;
			const symmetric = ready?.mode === "symmetric";
			const selectedCount = selected?.size ?? 0;
			const allSelected = symmetric && ready !== null && selected !== null && selected.size >= ready.changes.length && ready.changes.length > 0;
			const planMissing = hasChanges && ready !== null && !sharedBlocked && (ready.planId === void 0 || ready.confirmation === void 0);
			const canApply = ready !== null && !loading && !applying && completed === null && hasChanges && !sharedBlocked && !planMissing && !stale && (!symmetric || selectedCount > 0);
			const canUndo = completed !== null && ready !== null && ready.workspace !== void 0 && !undoing && !applying;
			const undoRestore = async () => {
				if (!canUndo || ready?.workspace === void 0) return;
				setUndoing(true);
				setError(null);
				try {
					const response = await fetch(`${PATH$1}/restore-undo`, {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						body: JSON.stringify({
							sessionId,
							cwd: ready.workspace
						})
					});
					const body = await responseJson(response);
					if (!response.ok) {
						const message = typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${String(response.status)}`;
						throw new Error(message);
					}
					const record = body;
					const undone = Array.isArray(record.undonePaths) ? record.undonePaths.length : 0;
					const skipped = Array.isArray(record.skippedPaths) ? record.skippedPaths.filter((item) => typeof item === "object" && item !== null && typeof item.path === "string") : [];
					const lines = [`已撤销本次恢复：${String(undone)} 个路径回到恢复前状态。`];
					for (const skip of skipped) lines.push(`跳过 ${skip.path}：${skip.reason}`);
					setCompleted(lines.join("\n"));
				} catch (undoError) {
					setError(`撤销失败：${messageOf(undoError)}`);
				} finally {
					setUndoing(false);
				}
			};
			const togglePath = (path) => {
				setSelected((current) => {
					if (current === null) return current;
					const next = new Set(current);
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
			};
			const setAllPaths = (selectAll) => {
				setSelected((current) => {
					if (current === null) return current;
					if (!selectAll) return /* @__PURE__ */ new Set();
					const readyNow = preview !== null && preview.status === "ready" ? preview : null;
					return readyNow === null ? current : new Set(readyNow.changes.map((change) => change.path));
				});
			};
			const loadAll = async () => {
				if (ready === null || !ready.truncated) return;
				setLoading(true);
				try {
					const collected = [...ready.changes];
					let offset = collected.length;
					while (offset < ready.totalChanges) {
						const page = decodePreview(await responseJson(await fetch(`${PATH$1}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}&details=1&offset=${String(offset)}&limit=200`, {
							headers: { accept: "application/json" },
							cache: "no-store"
						})));
						if (page.status !== "ready" || page.checkpointId !== ready.checkpointId || page.offset !== offset) throw new RewindRequestError("PLAN_STALE", "项目文件在展开列表时发生了变化。");
						collected.push(...page.changes);
						offset += page.changes.length;
						if (page.changes.length === 0) break;
					}
					setPreview({
						...ready,
						changes: collected,
						truncated: false
					});
				} catch (caught) {
					if (caught instanceof RewindRequestError && caught.code === "PLAN_STALE") setStale(true);
					setError(friendlyError(caught));
				} finally {
					setLoading(false);
				}
			};
			const applyRestore = async () => {
				if (ready === null || !canApply) return;
				setApplying(true);
				setError(null);
				try {
					let planId = ready.planId;
					let confirmation = ready.confirmation;
					if (ready.planId !== void 0 && ready.confirmation !== void 0 && symmetric && selected !== null && selected.size < ready.totalChanges) {
						const paths = ready.changes.filter((change) => selected.has(change.path)).map((change) => change.path);
						if (paths.length > 0) {
							if (pathsTooLong(paths)) throw new Error("勾选的文件过多，无法构造恢复请求；请减少勾选");
							const subset = await fetchSubsetPlan(`sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}`, paths);
							planId = subset.planId;
							confirmation = subset.confirmation;
						}
					}
					const result = await responseJson(await fetch(PATH$1, {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						body: JSON.stringify({
							mode,
							sessionId,
							messageSeq: ready.messageSeq,
							checkpointId: ready.checkpointId,
							planId,
							confirmation
						})
					}));
					if (mode === "code") {
						setCompleted("项目文件已恢复；当前对话保持不变。恢复前的文件已自动备份。");
						return;
					}
					setCompleted("项目文件已恢复，并已创建新对话。恢复前的文件已自动备份。");
					try {
						await openRestoredSession(result.sessionId ?? "", matched.promptText);
						onClose();
					} catch (navigationError) {
						setError(`文件已经恢复，新对话也已创建，但没能自动打开：${messageOf(navigationError)}`);
					}
				} catch (caught) {
					if ((caught instanceof RewindRequestError || caught instanceof SubsetPlanError) && (caught.code === "PLAN_STALE" || caught.code === "WORKSPACE_IN_USE")) setStale(true);
					setError(friendlyError(caught));
				} finally {
					setApplying(false);
				}
			};
			const radioName = `srw-${sessionId}-${String(matched.messageSeq)}`;
			return react.createElement("div", {
				className: "srw-overlay",
				role: "dialog",
				"aria-modal": "true"
			}, react.createElement("div", { className: "srw-dialog" }, react.createElement("div", { className: "srw-dialog-head" }, react.createElement("strong", null, "恢复到发送这条消息之前"), react.createElement("button", {
				type: "button",
				className: "srw-trigger",
				onClick: onClose,
				"aria-label": "关闭"
			}, "✕")), react.createElement("div", { className: "srw-content" }, react.createElement("div", { className: "srw-body" }, loading && react.createElement("p", { className: "srw-status" }, "正在检查可以恢复的项目文件…"), preview?.status === "pending" && react.createElement("p", { className: "srw-status" }, "这条消息发送之前的文件还在保存，请稍后再试。"), preview?.status === "missing" && react.createElement("p", { className: "srw-error" }, "没有保存这条消息发送之前的文件。可能是当时还未启用回退功能，或记录已超出保留期限。"), preview?.status === "skipped" && react.createElement("p", { className: "srw-status" }, "为避免阻塞消息发送，本轮没有自动保存文件：", preview.reason), preview?.status === "failed" && react.createElement("p", { className: "srw-error" }, "没能保存这条消息发送之前的文件：", preview.error), ready !== null && [
				react.createElement("div", { key: "options" }, optionRadio(radioName, "both", mode, applying, setMode, "恢复文件并从这里继续", "创建一个从这里开始的新会话（当前对话会保留）"), optionRadio(radioName, "code", mode, applying, setMode, "只恢复文件", "恢复这条消息发送之前的文件，当前对话保持不变。")),
				react.createElement("div", {
					className: "srw-summary",
					key: "summary"
				}, react.createElement("strong", null, symmetric ? `将恢复 ${String(selectedCount)} / ${String(ready.totalChanges)} 个文件` : `将恢复 ${String(ready.totalChanges)} 个文件`), react.createElement("span", null, mode === "both" ? "恢复后在新对话里继续" : "当前对话保持不变")),
				symmetric && react.createElement("p", {
					className: "srw-status",
					key: "hint"
				}, "对称模式：默认只勾选本会话改动的文件；勾选其它文件会把它们一并恢复到该时点。"),
				sharedBlocked && react.createElement("p", {
					className: "srw-error",
					key: "shared"
				}, "这个项目目录还有别的对话正在运行。恢复文件会影响到它们，因此本次操作已被阻止。"),
				gatedRunning > 0 && react.createElement("p", {
					className: "srw-warning",
					key: "gated"
				}, `另有 ${String(gatedRunning)} 个会话正在运行；其文件写入已被写入闸拒绝，不会影响本次恢复。`),
				ready.skippedPaths.length > 0 && react.createElement("div", {
					className: "srw-skipped",
					key: "skipped"
				}, [react.createElement("div", { key: "title" }, "以下文件未纳入快照，恢复不会改动它们："), ...ready.skippedPaths.map((skip) => react.createElement("div", { key: skip.path }, react.createElement("code", null, skip.path), `（${skipReasonLabel(skip.reason)}）`))]),
				planMissing && react.createElement("p", {
					className: "srw-error",
					key: "plan"
				}, "恢复信息已经失效，请重新检查。"),
				stale && react.createElement("p", {
					className: "srw-error",
					key: "stale"
				}, "项目文件在检查后又发生了变化。为避免覆盖新修改，本次恢复已失效，请重新检查。"),
				ready.totalChanges === 0 && react.createElement("p", {
					className: "srw-status",
					key: "nochanges"
				}, "项目文件已经是这条消息发送前的状态，无需恢复。"),
				ready.changes.length > 0 && react.createElement("div", {
					className: "srw-files",
					key: "files"
				}, [symmetric && react.createElement("label", {
					className: "srw-select-all",
					key: "selectall"
				}, react.createElement("input", {
					type: "checkbox",
					checked: allSelected,
					onChange: (event) => {
						setAllPaths(event.target.checked);
					}
				}), "全部选中（整树恢复）"), ...ready.changes.map((change) => react.createElement(PreviewFileRow, {
					key: change.path,
					change,
					checkpointId: ready.checkpointId,
					workspace: ready.workspace,
					symmetric,
					checked: selected?.has(change.path) ?? false,
					onTogglePath: () => {
						togglePath(change.path);
					}
				}))]),
				ready.truncated && react.createElement("button", {
					type: "button",
					className: "srw-retry",
					key: "more",
					onClick: () => {
						loadAll();
					}
				}, `查看全部 ${String(ready.totalChanges)} 个文件`)
			], completed !== null && react.createElement("p", {
				className: "srw-status",
				style: { whiteSpace: "pre-line" }
			}, completed), completed !== null && canUndo && react.createElement("button", {
				type: "button",
				className: "srw-retry",
				key: "undo",
				onClick: () => {
					undoRestore();
				},
				disabled: undoing
			}, undoing ? "正在撤销…" : "撤销本次恢复"), error !== null && react.createElement("p", { className: "srw-error" }, error), !loading && (preview === null || preview.status !== "ready" || stale || planMissing || sharedBlocked) && completed === null && react.createElement("button", {
				type: "button",
				className: "srw-retry",
				onClick: () => {
					load();
				}
			}, "重新检查"))), react.createElement("div", { className: "srw-foot" }, react.createElement("button", {
				type: "button",
				onClick: onClose,
				disabled: applying
			}, "取消"), react.createElement("button", {
				type: "button",
				onClick: () => {
					applyRestore();
				},
				disabled: !canApply
			}, applying ? "正在恢复…" : completed === null ? mode === "both" ? "恢复并从这里继续" : "恢复文件" : "已完成"))));
		}
		/**
		* 恢复预览的文件行（A3）：点击展开「当前 → 快照」方向的行级 diff——
		* del = 恢复会带走的当前行，add = 恢复会加回来的快照行。
		* 旧宿主没有 workspace 字段时退化为纯清单行（不展开）。
		*/
		function PreviewFileRow({ change, checkpointId, workspace, symmetric, checked, onTogglePath }) {
			const [open, setOpen] = react.useState(false);
			const badge = change.owner === void 0 || change.owner === "target" ? null : change.owner === "multi" ? "双方都改过" : change.owner === "unknown" ? "来源不明" : `会话 ${change.owner.length > 12 ? `${change.owner.slice(0, 12)}…` : change.owner}`;
			const expandable = workspace !== void 0 && change.kind !== "type-changed";
			return react.createElement("div", { key: change.path }, react.createElement("div", {
				className: "srw-file",
				"data-expandable": expandable ? "true" : void 0,
				onClick: expandable ? () => setOpen((current) => !current) : void 0
			}, symmetric && react.createElement("input", {
				type: "checkbox",
				checked,
				onClick: (event) => {
					event.stopPropagation();
				},
				onChange: onTogglePath
			}), react.createElement("code", null, change.path), badge !== null && react.createElement("span", { className: "srw-kind" }, badge), react.createElement("span", { className: "srw-kind" }, kindLabel$1(change.kind)), expandable && react.createElement("span", { className: "srw-kind" }, open ? "收起 ▲" : "对比 ▼")), open && expandable && react.createElement(PreviewFileDiff, {
				path: change.path,
				kind: change.kind,
				checkpointId,
				workspace
			}));
		}
		/** 行级预览内容：当前磁盘 vs 快照（方向 当前 → 快照）。 */
		function PreviewFileDiff({ path, kind, checkpointId, workspace }) {
			const [diff, setDiff] = react.useState(null);
			react.useEffect(() => {
				let active = true;
				setDiff(null);
				const isAddedNow = kind === "added";
				const isGoneNow = kind === "deleted";
				Promise.all([isGoneNow ? Promise.resolve("") : fetchCheckpointFileContent("live", path, workspace), isAddedNow ? Promise.resolve("") : fetchCheckpointFileContent(checkpointId, path, workspace)]).then(([current, snapshot]) => {
					if (!active) return;
					if (current === null && snapshot === null) {
						setDiff("unavailable");
						return;
					}
					setDiff([{
						path,
						oldText: current ?? "",
						newText: snapshot ?? ""
					}]);
				});
				return () => {
					active = false;
				};
			}, [
				path,
				kind,
				checkpointId,
				workspace
			]);
			if (diff === null) return react.createElement("div", { className: "srw-file-diff" }, react.createElement("p", { className: "srw-status" }, "加载全文…"));
			if (diff === "unavailable") return react.createElement("div", { className: "srw-file-diff" }, react.createElement("p", { className: "srw-status" }, "内容不可用（二进制文件或读取失败）。"));
			return react.createElement("div", { className: "srw-file-diff" }, react.createElement(UnifiedDiff, {
				diffs: diff,
				contextLines: 3,
				showCopyButton: true,
				labels: {
					copy: "复制差异",
					copied: "已复制",
					showUnchanged: (count) => `显示 ${String(count)} 行未变更内容`,
					hideUnchanged: (count) => `折叠 ${String(count)} 行未变更内容`,
					hunkN: (n) => `块 ${String(n)}`,
					hunkInclude: "勾选的块参与撤销/重做"
				}
			}));
		}
		function optionRadio(radioName, value, mode, disabled, setMode, title, description) {
			return react.createElement("label", {
				className: "srw-option",
				"data-selected": mode === value,
				key: value
			}, react.createElement("input", {
				type: "radio",
				name: radioName,
				checked: mode === value,
				disabled,
				onChange: () => setMode(value)
			}), react.createElement("span", { className: "srw-option-content" }, react.createElement("strong", null, title), react.createElement("span", { className: "srw-option-description" }, description)));
		}
		function decodePreview(value) {
			const record = recordOf(value);
			const status = requiredString(record.status, "status");
			if (status === "pending" || status === "missing") return { status };
			if (status === "skipped") return {
				status,
				reason: requiredString(record.reason, "reason")
			};
			if (status === "failed") return {
				status,
				error: requiredString(record.error, "error")
			};
			if (status !== "ready") throw new Error(`未知回退状态：${status}`);
			if (!Array.isArray(record.changes)) throw new Error("回退预览缺少 changes");
			const activeSessionIds = Array.isArray(record.activeSessionIds) ? record.activeSessionIds : [];
			const skippedPaths = Array.isArray(record.skippedPaths) ? record.skippedPaths.map((entry) => {
				const skip = recordOf(entry);
				return {
					path: requiredString(skip.path, "path"),
					reason: requiredString(skip.reason, "reason")
				};
			}) : [];
			return {
				status,
				sessionId: requiredString(record.sessionId, "sessionId"),
				messageSeq: requiredInteger(record.messageSeq, "messageSeq"),
				turn: requiredInteger(record.turn, "turn"),
				checkpointId: requiredString(record.checkpointId, "checkpointId"),
				...record.mode === "symmetric" || record.mode === "current-wins" ? { mode: record.mode } : {},
				totalChanges: requiredInteger(record.totalChanges, "totalChanges"),
				changes: record.changes.map((entry) => {
					const change = recordOf(entry);
					return {
						path: requiredString(change.path, "path"),
						kind: requiredString(change.kind, "kind"),
						...typeof change.owner === "string" ? { owner: change.owner } : {},
						...change.autoSelect === true ? { autoSelect: true } : {}
					};
				}),
				truncated: record.truncated === true,
				activeSessionIds,
				...typeof record.restoreBlocked === "boolean" ? { restoreBlocked: record.restoreBlocked } : {},
				...Array.isArray(record.gatedSessionIds) ? { gatedSessionIds: record.gatedSessionIds } : {},
				skippedPaths,
				...typeof record.workspace === "string" ? { workspace: record.workspace } : {},
				...typeof record.planId === "string" ? { planId: record.planId } : {},
				...typeof record.confirmation === "string" ? { confirmation: record.confirmation } : {},
				...typeof record.offset === "number" ? { offset: record.offset } : {}
			};
		}
		/** 跳过原因的用户文案。 */
		function skipReasonLabel(reason) {
			switch (reason) {
				case "too-large": return "超过大小上限";
				case "unsupported-type": return "文件类型不支持";
				case "read-failed": return "读取失败";
				default: return reason;
			}
		}
		function kindLabel$1(kind) {
			switch (kind) {
				case "added": return "移除后来新增的文件";
				case "deleted": return "找回文件";
				case "modified": return "恢复之前的版本";
				case "mode-changed": return "恢复文件权限";
				case "type-changed": return "恢复之前的文件类型";
				default: return kind;
			}
		}
		function friendlyError(error) {
			if (error instanceof RewindRequestError) switch (error.code) {
				case "PLAN_STALE": return "项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查后再恢复。";
				case "WORKSPACE_IN_USE": return "这个项目目录还有别的对话正在运行。请等那些对话结束或停止后，再重新检查。";
				case "WORKSPACE_LOCKED": return "另一个恢复操作正在处理这个项目目录。请等待它完成后重新检查。";
				case "RESTORE_POINT_NOT_FOUND": return "没有找到对应的文件状态，可能已被清理。";
				case "NO_CHANGES": return "项目文件已经是这条消息发送前的状态，无需恢复。";
				case "RESTORE_FAILED_ROLLED_BACK": return "恢复未能完成，项目文件已自动还原到操作前的状态。";
				case "CONVERSATION_REWIND_FAILED": return "文件已恢复，但无法创建新对话；项目文件已自动还原。";
				case "RECOVERY_REQUIRED": return error.message;
				default: return error.message;
			}
			return messageOf(error);
		}
		function collectTargets(nodes) {
			const rows = /* @__PURE__ */ new Map();
			for (const element of Array.from(document.querySelectorAll("[data-chat-flow-kind=\"user\"][data-chat-anchor-key]"))) {
				const key = element.dataset.chatAnchorKey;
				if (key !== void 0) rows.set(key, element);
			}
			const targets = [];
			for (const node of nodes) {
				const matched = selectRewindMessage(node);
				if (matched === null) continue;
				const anchorKey = typeof node.key === "string" ? node.key : `node:${String(node.seq)}`;
				const actions = rows.get(anchorKey)?.querySelector("[data-time-hover-root=\"true\"]")?.lastElementChild;
				if (!(actions instanceof HTMLElement)) continue;
				targets.push({
					container: actions,
					matched
				});
			}
			return targets;
		}
		function sameTargets(left, right) {
			return left.length === right.length && left.every((target, index) => {
				const other = right[index];
				return other !== void 0 && target.container === other.container && target.matched.messageSeq === other.matched.messageSeq;
			});
		}
		async function openSessionWithDraft(ctx, sessionId, promptText) {
			let lastError = /* @__PURE__ */ new Error("新对话还没有准备好");
			for (let attempt = 0; attempt < 20; attempt += 1) {
				try {
					ctx.sessions.open(sessionId);
					const scope = ctx.sessions.scope(sessionId);
					if (scope !== void 0) {
						ctx.conversation.input.for(scope).setDraft(promptText);
						return;
					}
					lastError = /* @__PURE__ */ new Error("新对话还没有准备好");
				} catch (error) {
					lastError = error;
				}
				await new Promise((resolve) => {
					setTimeout(resolve, 50);
				});
			}
			throw lastError;
		}
		async function responseJson(response) {
			const value = await response.json();
			if (!response.ok) {
				const record = recordOf(value);
				throw new RewindRequestError(typeof record.code === "string" ? record.code : "REWIND_FAILED", typeof record.error === "string" ? record.error : `请求失败：${String(response.status)}`);
			}
			return value;
		}
		var RewindRequestError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.code = code;
			}
		};
		function recordOf(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("服务器返回了无效对象");
			return value;
		}
		function requiredString(value, name) {
			if (typeof value !== "string" || value === "") throw new Error(`${name} 无效`);
			return value;
		}
		function requiredInteger(value, name) {
			if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} 无效`);
			return value;
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region src/client/timeline-panel.tsx
		/**
		* dsh-shadow-rewind —— 时间线浮层面板（借鉴 dsh-checkpoint-diff 的
		* DiffPanel 思路：header action 触发、自绘浮层、时间线选区 → 区间 diff）。
		*
		* 职责：一个工作台式的「这台机器这个项目发生过什么」视图——
		*  - 时间线：turn 快照检查点（轮起/轮末、意图标签、degraded 降级标注）+
		*    会话轨迹节点（tool/call 边界）；
		*  - 选区对比：选两个检查点 → 快照逐文件对比；选两个轨迹节点 → 内容重放
		*    区间 diff（write/edit/str_replace_editor，附盲区 notes）；
		*  - 逐文件行级 diff 渲染复用 UnifiedDiff；快照对比的内容经 /shadow-rewind/file
		*    端点按需懒取。
		*
		* 与侧边栏「文件审查」tab 互补不互斥：侧边栏管逐轮审查与 hunk 撤销，
		* 浮层管跨轮审计与回看；恢复入口仍走消息旁回退按钮 / 侧边栏每轮快照恢复
		* （那里有完整的安全闸与确认流）。
		* TODO: 天花板——面板内暂不直接发起恢复（复用计划+确认串的安全闸需要
		* 跨组件状态）；升级路径：把恢复预览对话框抽成共享组件后从面板深链。
		*/
		const PATH = "/shadow-rewind/trace";
		/** 上次查看记忆的 localStorage 键：sessionId → { from, to }（会话内节点对）。 */
		const LAST_VIEW_KEY = "dsh-shadow-rewind:last-view";
		/** 读取上次查看的节点对（形状非法/缺失返回 null；节点存在性由调用方校验）。 */
		function loadLastView(sessionId) {
			try {
				const raw = localStorage.getItem(LAST_VIEW_KEY);
				if (raw === null) return null;
				const entry = JSON.parse(raw)[sessionId];
				if (typeof entry !== "object" || entry === null) return null;
				const record = entry;
				const parse = (value) => {
					if (typeof value !== "object" || value === null) return null;
					const sel = value;
					if (sel.kind === "checkpoint" && typeof sel.id === "string" && sel.id.startsWith("rp_")) return {
						kind: "checkpoint",
						id: sel.id
					};
					if (sel.kind === "trace" && typeof sel.id === "string" && sel.id.startsWith("trace:")) return {
						kind: "trace",
						id: sel.id
					};
					return null;
				};
				const from = parse(record.from);
				const to = parse(record.to);
				return from === null || to === null ? null : {
					from,
					to
				};
			} catch {
				return null;
			}
		}
		function saveLastView(sessionId, selection) {
			if (selection.length !== 2) return;
			try {
				const all = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) ?? "{}");
				all[sessionId] = {
					from: selection[0],
					to: selection[1]
				};
				localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(all));
			} catch {}
		}
		const STYLE_ID = "dsh-shadow-rewind-timeline";
		const styles = `
.srw-tl-trigger{display:inline-flex;align-items:center;height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px}
.srw-tl-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.srw-tl-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:min(880px,100%);max-height:calc(100dvh - 96px);padding:16px 18px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#111a2e);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));box-shadow:0 18px 60px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e6ecff)}
.srw-tl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:600}
.srw-tl-close{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:18px;line-height:1;padding:4px}
.srw-tl-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px}
.srw-tl-section{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.srw-tl-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.srw-tl-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;cursor:pointer;min-width:0}
.srw-tl-row:last-child{border-bottom:0}
.srw-tl-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-tl-row[data-selected="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.srw-tl-row[data-degraded="true"]{color:var(--dsw-alias-state-warn-primary)}
.srw-tl-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.srw-tl-row[data-mutating="true"] .srw-tl-dot{background:var(--dsw-alias-state-success-primary,#4ade80)}
.srw-tl-row[data-error="true"] .srw-tl-dot{background:var(--dsw-alias-state-error-primary)}
.srw-tl-main{flex:1;min-width:0;display:flex;align-items:center;gap:8px}
.srw-tl-main code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.srw-tl-meta{flex:none;color:var(--dsw-alias-label-tertiary)}
.srw-tl-chip{flex:none;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:11px}
.srw-tl-bar{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.srw-tl-bar button{height:28px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px}
.srw-tl-bar button:disabled{opacity:.5;cursor:default}
.srw-tl-bar button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.srw-tl-selects{display:flex;gap:10px}
.srw-tl-select{display:flex;flex:1;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary);min-width:0}
.srw-tl-select select{flex:1;min-width:0;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 6px}
/* (head) 检查点：左侧高亮竖线标记当前最新状态。 */
.srw-tl-row[data-head="true"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary)}
.srw-tl-row[data-head="true"] .srw-tl-dot{background:var(--dsw-alias-state-business-primary)}

/* ── 横向拖选时间线条带：双轨（快照 / 调用三泳道），等宽槽位投影 ── */
.srw-tl-strip{display:flex;flex-direction:column;gap:4px;touch-action:none}
.srw-tl-track{position:relative;display:flex;align-items:center;gap:8px;user-select:none}
.srw-tl-trackLabel{flex:0 0 auto;width:32px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.srw-tl-cells{position:relative;display:flex;flex:1;min-height:16px;align-items:stretch;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
.srw-tl-cell{flex:1 1 0;min-width:2px;margin:0 1px;border-radius:3px;background:var(--dsw-alias-label-tertiary);opacity:.45;cursor:pointer}
.srw-tl-cell[data-phase="end"]{opacity:.9}
.srw-tl-cell[data-degraded="true"]{background:var(--dsw-alias-state-warn-primary);opacity:.9}
.srw-tl-lanes{display:flex;flex-direction:column;gap:2px;padding:2px}
.srw-tl-lane{position:relative;min-height:8px}
.srw-tl-span{position:absolute;top:0;height:100%;min-width:2px;border-radius:2px;background:var(--dsw-alias-label-tertiary);opacity:.6;cursor:pointer}
.srw-tl-span[data-kind="user"]{background:var(--dsw-alias-label-primary);opacity:.85}
.srw-tl-span[data-kind="assistant"]{background:var(--dsw-alias-label-secondary);opacity:.75}
.srw-tl-span[data-mutating="true"]{background:var(--dsw-alias-state-success-primary);opacity:.9}
.srw-tl-span[data-error="true"]{background:var(--dsw-alias-state-error-primary);opacity:.95}
.srw-tl-tick{position:absolute;top:-2px;width:1px;height:calc(100% + 4px);background:var(--dsw-alias-border-l3)}
.srw-tl-band{position:absolute;top:0;height:100%;pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent);border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px}
.srw-tl-draftHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px}
.srw-tl-notes{margin:0;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.srw-tl-diff{display:flex;flex-direction:column;gap:8px}
.srw-tl-file{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.srw-tl-file-head{display:flex;justify-content:space-between;gap:10px;padding:6px 10px;font-size:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.srw-tl-file-head code{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.srw-tl-file-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-tl-file-body{max-height:340px;overflow:auto}
.srw-tl-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.srw-tl-error{margin:0;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px}
`;
		/** 下拉选项：检查点 + 轨迹节点统一寻址。 */
		function selectionOptions(data) {
			const options = [];
			for (const point of data.checkpoints) options.push({
				value: point.id,
				label: `快照 轮${String(point.turn)} ${point.phase === "end" ? "轮末" : "轮起"}`
			});
			for (const node of data.nodes) options.push({
				value: `trace:${String(node.seq)}`,
				label: `#${String(node.seq)} ${node.name}${node.path === void 0 ? "" : ` ${node.path}`}`
			});
			return options;
		}
		async function fetchJson(url) {
			const response = await fetch(url, {
				headers: { accept: "application/json" },
				cache: "no-store"
			});
			const body = await response.json().catch(() => null);
			if (!response.ok) {
				const message = body !== null && typeof body === "object" && typeof body.error === "string" ? body.error : `HTTP ${String(response.status)}`;
				throw new Error(message);
			}
			return body;
		}
		function parseTimeline(value) {
			if (typeof value !== "object" || value === null) return null;
			const record = value;
			if (typeof record.cwd !== "string" || !Array.isArray(record.nodes) || !Array.isArray(record.checkpoints)) return null;
			const nodes = [];
			for (const raw of record.nodes) {
				if (typeof raw !== "object" || raw === null) continue;
				const node = raw;
				if (typeof node.seq !== "number" || typeof node.name !== "string") continue;
				nodes.push({
					seq: node.seq,
					name: node.name,
					...typeof node.path === "string" ? { path: node.path } : {},
					mutating: node.mutating === true,
					...node.error === true ? { error: true } : {}
				});
			}
			const checkpoints = [];
			for (const raw of record.checkpoints) {
				if (typeof raw !== "object" || raw === null) continue;
				const point = raw;
				if (typeof point.id !== "string" || typeof point.turn !== "number") continue;
				checkpoints.push({
					id: point.id,
					turn: point.turn,
					...point.phase === "end" ? { phase: "end" } : point.phase === "start" ? { phase: "start" } : {},
					...typeof point.createdAt === "number" ? { createdAt: point.createdAt } : {},
					...typeof point.fileCount === "number" ? { fileCount: point.fileCount } : {},
					...point.degraded === true ? { degraded: true } : {},
					...Array.isArray(point.intent) ? { intent: point.intent.filter((item) => typeof item === "object" && item !== null).map((item) => ({
						tool: String(item.tool ?? ""),
						path: String(item.path ?? ""),
						seq: typeof item.seq === "number" ? item.seq : 0
					})).filter((item) => item.tool !== "" && item.path !== "") } : {}
				});
			}
			const spans = [];
			if (Array.isArray(record.spans)) for (const raw of record.spans) {
				if (typeof raw !== "object" || raw === null) continue;
				const span = raw;
				if (typeof span.seq !== "number" || typeof span.lane !== "number") continue;
				const kind = span.kind === "user" || span.kind === "assistant" || span.kind === "tool" ? span.kind : null;
				const lane = span.lane === 0 || span.lane === 1 || span.lane === 2 ? span.lane : null;
				if (kind === null || lane === null) continue;
				spans.push({
					seq: span.seq,
					kind,
					lane,
					...typeof span.name === "string" ? { name: span.name } : {},
					...span.mutating === true ? { mutating: true } : {},
					...span.error === true ? { error: true } : {}
				});
			}
			const turnBoundaries = Array.isArray(record.turnBoundaries) ? record.turnBoundaries.filter((seq) => typeof seq === "number") : [];
			return {
				cwd: record.cwd,
				nodes,
				checkpoints,
				spans,
				turnBoundaries
			};
		}
		function parseRange(value) {
			if (typeof value !== "object" || value === null) return null;
			const record = value;
			if (record.mode !== "trace" && record.mode !== "checkpoint" || typeof record.from !== "string" || typeof record.to !== "string" || typeof record.cwd !== "string" || !Array.isArray(record.changes)) return null;
			const changes = [];
			for (const raw of record.changes) {
				if (typeof raw !== "object" || raw === null) continue;
				const change = raw;
				if (typeof change.path !== "string") continue;
				const kind = change.kind === "added" || change.kind === "deleted" || change.kind === "modified" ? change.kind : null;
				if (kind === null) continue;
				changes.push({
					path: change.path,
					kind,
					...change.before === null || typeof change.before === "string" ? { before: change.before } : {},
					...change.after === null || typeof change.after === "string" ? { after: change.after } : {},
					...typeof change.added === "number" ? { added: change.added } : {},
					...typeof change.removed === "number" ? { removed: change.removed } : {}
				});
			}
			return {
				mode: record.mode,
				from: record.from,
				to: record.to,
				cwd: record.cwd,
				changes,
				...Array.isArray(record.notes) ? { notes: record.notes.filter((note) => typeof note === "string") } : {}
			};
		}
		function timelineApply(ctx) {
			ctx.effect(() => {
				if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {};
				const tag = document.createElement("style");
				tag.dataset.plugin = STYLE_ID;
				tag.dataset.pluginCss = STYLE_ID;
				tag.textContent = styles;
				document.head.appendChild(tag);
				return () => {
					tag.remove();
				};
			}, "shadow-rewind-timeline: styles");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "shadow-rewind-timeline",
				order: 101
			}, TimelineAction));
		}
		function TimelineAction({ sessionId }) {
			const [open, setOpen] = react.useState(false);
			return react.createElement(react.Fragment, null, react.createElement("button", {
				type: "button",
				className: "srw-tl-trigger",
				title: "文件时间线：快照检查点与工具调用轨迹的区间对比",
				onClick: () => setOpen(true)
			}, "时间线"), open && react.createElement(TimelinePanel, {
				sessionId,
				onClose: () => setOpen(false)
			}));
		}
		/**
		* 横向拖选时间线条带（借鉴 dsh-checkpoint-diff 的 TraceTimeline 手势设计）：
		* 双轨模型——快照轨（检查点槽位）与调用轨（三泳道 spans）各自等宽投影，
		* 轨内拖选 ≥3px 提交选区对（同轨内吸附，天然不混类），单击锁定单节点。
		* 手势状态机：pointerdown 记锚点 → 窗口级 move/up（画布外释放同样收束），
		* draft 选区带实时渲染；Esc 交给面板（关闭），拖选天然随 pointerup 收束。
		*/
		function TraceStrip({ data, selection, onCommit, onSingle }) {
			const [draft, setDraft] = react.useState(null);
			const dragRef = react.useRef(null);
			const cellCount = (track) => track === "snapshot" ? data.checkpoints.length : data.spans.length;
			const cellEntry = (track, index) => {
				if (track === "snapshot") {
					const point = data.checkpoints[index];
					return point === void 0 ? null : {
						kind: "checkpoint",
						id: point.id
					};
				}
				const span = data.spans[index];
				return span === void 0 ? null : {
					kind: "trace",
					id: `trace:${String(span.seq)}`
				};
			};
			const startDrag = (track, event) => {
				const count = cellCount(track);
				if (count === 0) return;
				const rect = event.currentTarget.getBoundingClientRect();
				dragRef.current = {
					track,
					anchorX: event.clientX,
					rect,
					moved: false
				};
				const indexFromX = (x) => Math.max(0, Math.min(count - 1, Math.floor((x - rect.left) / rect.width * count)));
				const move = (ev) => {
					const drag = dragRef.current;
					if (drag === null) return;
					if (Math.abs(ev.clientX - drag.anchorX) >= 3) drag.moved = true;
					if (drag.moved) setDraft({
						track,
						left: indexFromX(Math.min(ev.clientX, drag.anchorX)),
						right: indexFromX(Math.max(ev.clientX, drag.anchorX))
					});
				};
				const up = (ev) => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", up);
					const drag = dragRef.current;
					dragRef.current = null;
					setDraft(null);
					if (drag === null) return;
					const a = indexFromX(Math.min(ev.clientX, drag.anchorX));
					const b = indexFromX(Math.max(ev.clientX, drag.anchorX));
					const first = cellEntry(track, a);
					const second = cellEntry(track, b);
					if (first === null || second === null) return;
					if (!drag.moved || a === b) {
						onSingle(first);
						return;
					}
					onCommit(first, second);
				};
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
			};
			const band = (track) => {
				if (selection.length !== 2) return null;
				const kind = track === "snapshot" ? "checkpoint" : "trace";
				if (selection[0].kind !== kind || selection[1].kind !== kind) return null;
				const indexOf = (sel) => {
					if (track === "snapshot") return data.checkpoints.findIndex((point) => point.id === sel.id);
					return data.spans.findIndex((span) => `trace:${String(span.seq)}` === sel.id);
				};
				const a = indexOf(selection[0]);
				const b = indexOf(selection[1]);
				if (a < 0 || b < 0) return null;
				const left = Math.min(a, b);
				const right = Math.max(a, b);
				const count = cellCount(track);
				return {
					left: left / count * 100,
					width: (right - left + 1) / count * 100
				};
			};
			const snapshotBand = band("snapshot");
			const traceBand = band("trace");
			const spanCount = data.spans.length;
			return react.createElement("div", { className: "srw-tl-strip" }, react.createElement("div", {
				className: "srw-tl-track",
				"data-track": "snapshot",
				onPointerDown: (event) => {
					startDrag("snapshot", event);
				}
			}, react.createElement("span", { className: "srw-tl-trackLabel" }, "快照"), react.createElement("div", { className: "srw-tl-cells" }, data.checkpoints.map((point) => react.createElement("span", {
				key: point.id,
				className: "srw-tl-cell",
				"data-phase": point.phase === "end" ? "end" : "start",
				"data-degraded": point.degraded === true,
				title: `轮 ${String(point.turn)} ${point.phase === "end" ? "轮末" : "轮起"}${point.degraded === true ? "（内容不可读）" : ""}`
			}))), snapshotBand !== null && react.createElement("div", {
				className: "srw-tl-band",
				style: {
					left: `${String(snapshotBand.left)}%`,
					width: `${String(snapshotBand.width)}%`
				}
			})), react.createElement("div", {
				className: "srw-tl-track",
				"data-track": "trace",
				onPointerDown: (event) => {
					startDrag("trace", event);
				}
			}, react.createElement("span", { className: "srw-tl-trackLabel" }, "调用"), react.createElement("div", { className: "srw-tl-cells srw-tl-lanes" }, [
				0,
				1,
				2
			].map((lane) => react.createElement("div", {
				key: lane,
				className: "srw-tl-lane"
			}, data.spans.filter((span) => span.lane === lane).map((span) => {
				const index = data.spans.indexOf(span);
				return react.createElement("span", {
					key: `${String(span.seq)}`,
					className: "srw-tl-span",
					"data-kind": span.kind,
					"data-mutating": span.mutating === true,
					"data-error": span.error === true,
					title: `${span.kind === "tool" ? span.name ?? "tool" : span.kind === "user" ? "用户消息" : "助手消息"}${span.error === true ? "（失败）" : ""}`,
					style: {
						left: `${String(index / Math.max(1, spanCount) * 100)}%`,
						width: `calc(${String(1 / Math.max(1, spanCount) * 100)}% - 1px)`
					}
				});
			}))), data.turnBoundaries.map((seq) => {
				const index = data.spans.findIndex((span) => span.seq >= seq);
				if (index < 0) return null;
				return react.createElement("span", {
					key: `tick:${String(seq)}`,
					className: "srw-tl-tick",
					style: { left: `${String(index / Math.max(1, spanCount) * 100)}%` }
				});
			})), traceBand !== null && react.createElement("div", {
				className: "srw-tl-band",
				style: {
					left: `${String(traceBand.left)}%`,
					width: `${String(traceBand.width)}%`
				}
			})), draft !== null && react.createElement("div", { className: "srw-tl-draftHint" }, `松开以对比选中的 ${String(draft.right - draft.left + 1)} 个节点`));
		}
		function TimelinePanel({ sessionId, onClose }) {
			const [data, setData] = react.useState(null);
			const [loadError, setLoadError] = react.useState(null);
			const [selection, setSelection] = react.useState([]);
			const [range, setRange] = react.useState(null);
			const [rangeLoading, setRangeLoading] = react.useState(false);
			const [rangeError, setRangeError] = react.useState(null);
			const [expanded, setExpanded] = react.useState(/* @__PURE__ */ new Set());
			const [restoredHint, setRestoredHint] = react.useState(false);
			const load = react.useCallback(() => {
				let active = true;
				setLoadError(null);
				fetchJson(`${PATH}?sessionId=${encodeURIComponent(sessionId)}`).then((body) => {
					if (!active) return;
					const parsed = parseTimeline(body);
					if (parsed === null) {
						setLoadError("时间线数据格式无法识别");
						return;
					}
					setData(parsed);
					const lastView = loadLastView(sessionId);
					if (lastView === null) return;
					const exists = (sel) => sel.kind === "checkpoint" ? parsed.checkpoints.some((point) => point.id === sel.id) : parsed.nodes.some((node) => `trace:${String(node.seq)}` === sel.id);
					if (exists(lastView.from) && exists(lastView.to)) {
						setSelection([lastView.from, lastView.to]);
						setRestoredHint(true);
					}
				}).catch((error) => {
					if (active) setLoadError(error instanceof Error ? error.message : String(error));
				});
				return () => {
					active = false;
				};
			}, [sessionId]);
			react.useEffect(() => load(), [load]);
			react.useEffect(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("keydown", onKey);
				};
			}, [onClose]);
			const mixed = selection.length === 2 && selection[0].kind !== selection[1].kind;
			const ready = selection.length === 2 && !mixed;
			const compare = react.useCallback(() => {
				if (data === null || selection.length !== 2 || mixed) return;
				const [first, second] = selection;
				setRange(null);
				setRangeError(null);
				setExpanded(/* @__PURE__ */ new Set());
				setRangeLoading(true);
				fetchJson(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&from=${encodeURIComponent(first.id)}&to=${encodeURIComponent(second.id)}`).then((body) => {
					const parsed = parseRange(body);
					if (parsed === null) {
						setRangeError("对比数据格式无法识别");
						return;
					}
					setRange(parsed);
					saveLastView(sessionId, [first, second]);
					setRestoredHint(false);
				}).catch((error) => setRangeError(error instanceof Error ? error.message : String(error))).finally(() => setRangeLoading(false));
			}, [
				data,
				sessionId,
				selection,
				mixed
			]);
			const toggleSelect = (entry) => {
				setRange(null);
				setRangeError(null);
				setRestoredHint(false);
				setSelection((current) => {
					if (current.some((item) => item.kind === entry.kind && item.id === entry.id)) return current.filter((item) => !(item.kind === entry.kind && item.id === entry.id));
					const next = [...current, entry];
					return next.length > 2 ? next.slice(next.length - 2) : next;
				});
			};
			/** 下拉双槽写入：两槽模型（空槽填充、满槽替换/移除），与点选同一 state。 */
			const setSlot = (index, entry) => {
				setRange(null);
				setRangeError(null);
				setRestoredHint(false);
				setSelection((current) => {
					const base = [...current];
					if (entry === null) {
						base.splice(index, 1);
						return base;
					}
					if (index < base.length) base[index] = entry;
					else if (base.length < 2) base.push(entry);
					else base[1] = entry;
					return base;
				});
			};
			const renderSelect = (label, slot) => react.createElement("label", {
				className: "srw-tl-select",
				key: label
			}, react.createElement("span", null, label), react.createElement("select", {
				value: selection[slot]?.id ?? "",
				onChange: (event) => {
					const value = event.target.value;
					if (value === "") {
						setSlot(slot, null);
						return;
					}
					setSlot(slot, value.startsWith("rp_") ? {
						kind: "checkpoint",
						id: value
					} : {
						kind: "trace",
						id: value
					});
				}
			}, react.createElement("option", { value: "" }, "选择节点"), data === null ? [] : selectionOptions(data).map((option) => react.createElement("option", {
				key: option.value,
				value: option.value
			}, option.label))));
			const toggleExpanded = (key) => {
				setExpanded((current) => {
					const next = new Set(current);
					if (next.has(key)) next.delete(key);
					else next.add(key);
					return next;
				});
			};
			const newestId = data !== null && data.checkpoints.length > 0 ? data.checkpoints.reduce((last, point) => (point.createdAt ?? 0) >= (data.checkpoints.find((entry) => entry.id === last)?.createdAt ?? 0) ? point.id : last, data.checkpoints[0].id) : void 0;
			return react.createElement("div", {
				className: "srw-overlay",
				onPointerDown: (event) => {
					if (event.target === event.currentTarget) onClose();
				}
			}, react.createElement("div", { className: "srw-tl-dialog" }, react.createElement("div", { className: "srw-tl-head" }, react.createElement("span", null, "文件时间线"), react.createElement("button", {
				type: "button",
				className: "srw-tl-close",
				onClick: onClose,
				"aria-label": "关闭"
			}, "×")), react.createElement("div", { className: "srw-tl-bar" }, react.createElement("span", null, mixed ? "快照检查点与轨迹节点不可混选" : selection.length === 2 ? "已选两点，点击「对比」查看区间差异" : selection.length === 1 ? "再点选一个同类节点作为区间另一端" : "点选两个节点（快照检查点或工具调用）做区间对比"), react.createElement("button", {
				type: "button",
				onClick: compare,
				disabled: !ready || rangeLoading
			}, rangeLoading ? "对比中…" : "对比"), react.createElement("button", {
				type: "button",
				onClick: () => {
					setSelection([]);
					setRange(null);
					setRangeError(null);
					setRestoredHint(false);
				},
				disabled: selection.length === 0
			}, "清除选区")), data !== null && react.createElement("div", {
				className: "srw-tl-selects",
				key: "selects"
			}, renderSelect("起", 0), renderSelect("终", 1)), restoredHint && react.createElement("p", {
				className: "srw-tl-status",
				key: "restored"
			}, "已恢复上次查看的位置；重新选择后将更新记忆。"), loadError !== null && react.createElement("p", { className: "srw-tl-error" }, `时间线加载失败：${loadError}`), react.createElement("div", { className: "srw-tl-body" }, data === null && loadError === null && react.createElement("p", { className: "srw-tl-status" }, "加载中…"), data !== null && [
				react.createElement(TraceStrip, {
					key: "strip",
					data,
					selection,
					onCommit: (a, b) => {
						setSelection([a, b]);
						setRange(null);
						setRangeError(null);
						setRestoredHint(false);
					},
					onSingle: (entry) => {
						setSelection([entry]);
						setRange(null);
						setRangeError(null);
						setRestoredHint(false);
					}
				}),
				react.createElement("span", {
					className: "srw-tl-section",
					key: "cp-title"
				}, "快照检查点（每轮起/轮末自动捕获）"),
				data.checkpoints.length === 0 && react.createElement("p", {
					className: "srw-tl-status",
					key: "cp-empty"
				}, "暂无检查点（可能未开启自动检查点）。"),
				react.createElement("div", {
					className: "srw-tl-list",
					key: "cp-list"
				}, data.checkpoints.map((point) => react.createElement("div", {
					key: point.id,
					className: "srw-tl-row",
					"data-selected": selection.some((item) => item.kind === "checkpoint" && item.id === point.id),
					"data-degraded": point.degraded === true,
					"data-head": point.id === newestId,
					onClick: () => toggleSelect({
						kind: "checkpoint",
						id: point.id
					})
				}, react.createElement("span", { className: "srw-tl-dot" }), react.createElement("span", { className: "srw-tl-main" }, react.createElement("code", null, `轮 ${String(point.turn)} ${point.phase === "end" ? "轮末" : "轮起"}`, point.degraded === true ? " ⚠ 内容不可读" : "", point.id === newestId ? " (head)" : ""), (point.intent ?? []).map((item) => react.createElement("span", {
					key: `${item.seq}`,
					className: "srw-tl-chip",
					title: `${item.tool} ${item.path}`
				}, `${item.tool} ${item.path}`))), react.createElement("span", { className: "srw-tl-meta" }, `${String(point.fileCount ?? 0)} 文件`, typeof point.createdAt === "number" ? ` · ${new Date(point.createdAt).toLocaleTimeString()}` : "")))),
				react.createElement("span", {
					className: "srw-tl-section",
					key: "tr-title"
				}, "工具调用轨迹（内容重放区间；终端与外部写盘不可见）"),
				data.nodes.length === 0 && react.createElement("p", {
					className: "srw-tl-status",
					key: "tr-empty"
				}, "本会话还没有工具调用。"),
				react.createElement("div", {
					className: "srw-tl-list",
					key: "tr-list"
				}, data.nodes.map((node) => react.createElement("div", {
					key: `trace:${String(node.seq)}`,
					className: "srw-tl-row",
					"data-mutating": node.mutating,
					"data-error": node.error === true,
					"data-selected": selection.some((item) => item.kind === "trace" && item.id === `trace:${String(node.seq)}`),
					onClick: () => toggleSelect({
						kind: "trace",
						id: `trace:${String(node.seq)}`
					})
				}, react.createElement("span", { className: "srw-tl-dot" }), react.createElement("span", { className: "srw-tl-main" }, react.createElement("code", null, `#${String(node.seq)} ${node.name}`, node.path === void 0 ? "" : ` ${node.path}`), node.error === true && react.createElement("span", { className: "srw-tl-chip" }, "失败")))))
			], range !== null && react.createElement(RangeView, {
				key: "range",
				result: range,
				expanded,
				onToggle: toggleExpanded
			}))));
		}
		/** 区间对比结果：轨迹模式全文自带，快照模式逐文件懒取。 */
		function RangeView({ result, expanded, onToggle }) {
			if (result.changes.length === 0) return react.createElement("p", { className: "srw-tl-status" }, "区间内没有文件变更。");
			return react.createElement("div", { className: "srw-tl-diff" }, result.mode === "trace" && (result.notes ?? []).map((note, index) => react.createElement("p", {
				className: "srw-tl-notes",
				key: String(index)
			}, note)), result.changes.map((change) => {
				const key = `${result.mode}:${change.path}`;
				const isOpen = expanded.has(key);
				const counts = change.added === void 0 && change.removed === void 0 ? "" : ` +${String(change.added ?? 0)} −${String(change.removed ?? 0)}`;
				return react.createElement("div", {
					className: "srw-tl-file",
					key
				}, react.createElement("div", {
					className: "srw-tl-file-head",
					onClick: () => onToggle(key)
				}, react.createElement("code", null, change.path), react.createElement("span", { className: "srw-tl-meta" }, `${kindLabel(change.kind)}${counts}`, result.mode === "checkpoint" && !isOpen ? " · 点击加载全文" : "")), isOpen && react.createElement("div", { className: "srw-tl-file-body" }, react.createElement(FileDiff, {
					result,
					change
				})));
			}));
		}
		function FileDiff({ result, change }) {
			const [diff, setDiff] = react.useState(null);
			react.useEffect(() => {
				let active = true;
				setDiff(null);
				if (result.mode === "trace") {
					if (change.before === null && change.after === null) {
						setDiff("unavailable");
						return;
					}
					setDiff([{
						path: change.path,
						oldText: change.before ?? null,
						newText: change.after ?? ""
					}]);
					return;
				}
				Promise.all([change.kind === "added" ? Promise.resolve(null) : fetchCheckpointFileContent(result.from, change.path, result.cwd), change.kind === "deleted" ? Promise.resolve("") : fetchCheckpointFileContent(result.to, change.path, result.cwd)]).then(([before, after]) => {
					if (!active) return;
					if (before === null && after === null) setDiff("unavailable");
					else setDiff([{
						path: change.path,
						oldText: before,
						newText: after ?? ""
					}]);
				});
				return () => {
					active = false;
				};
			}, [result, change]);
			if (diff === null) return react.createElement("p", { className: "srw-tl-status" }, "加载全文…");
			if (diff === "unavailable") return react.createElement("p", { className: "srw-tl-status" }, "内容不可用（二进制文件或超出预览上限）。");
			return react.createElement(UnifiedDiff, {
				diffs: diff,
				contextLines: 3,
				showCopyButton: true,
				navigation: true,
				labels: {
					copy: "复制差异",
					copied: "已复制",
					showUnchanged: (count) => `显示 ${String(count)} 行未变更内容`,
					hideUnchanged: (count) => `折叠 ${String(count)} 行未变更内容`,
					hunkN: (n) => `块 ${String(n)}`,
					hunkInclude: "勾选的块参与撤销/重做"
				}
			});
		}
		function kindLabel(kind) {
			if (kind === "added") return "新增";
			if (kind === "deleted") return "删除";
			return "修改";
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* 两个子面的 inject 并集：sessions（会话快照）、locale（词典）、remote
		* （Typert）、slots（轮尾链与 header actions）、conversation（草稿注入，
		* 用于「恢复并继续」打开新会话）。betterSidebar 不在其中：它只由可选的
		* dsh-better-sidebar 插件提供，静态声明会让整个插件在未安装该插件的宿主
		* 上永远 pending——改在 applyFileReview 里动态解析（缺失仅降级掉侧边栏
		* tab 面，其余全部可用）。
		*/
		const inject = [
			"sessions",
			"locale",
			"remote",
			"slots",
			"conversation"
		];
		/** 客户端插件主体：挂载 rewind 面、时间线面板与文件审查面。 */
		function apply(ctx) {
			rewindApply(ctx);
			timelineApply(ctx);
			applyFileReview(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
