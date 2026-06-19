/**
 * execute.ts - Execute a resolved SDK method, handling paging and streaming.
 */

import type { MethodEntry } from "./introspect.ts";

export interface ExecuteOptions {
  stream?: boolean | true;
}

type PageLike = {
  data: unknown[];
  hasNextPage(): boolean;
  getNextPage(): Promise<unknown>;
};

/**
 * Detect whether a value is a pageable Page object.
 * A Page has Symbol.asyncIterator AND hasNextPage/data.
 */
function isPage(value: unknown): value is AsyncIterable<unknown> & PageLike {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Symbol.asyncIterator in (value as object) &&
    typeof v["hasNextPage"] === "function" &&
    "data" in v
  );
}

/**
 * Collect all pages from a pageable result into a flat array.
 */
async function collectPages(firstPage: PageLike): Promise<unknown[]> {
  const results: unknown[] = [];
  let page: PageLike = firstPage;

  while (true) {
    results.push(...page.data);
    if (!page.hasNextPage()) break;
    page = (await page.getNextPage()) as PageLike;
  }

  return results;
}

/**
 * Async generator that yields items from all pages.
 */
async function* streamPages(firstPage: PageLike): AsyncGenerator<unknown> {
  let page: PageLike = firstPage;
  while (true) {
    for (const item of page.data) {
      yield item;
    }
    if (!page.hasNextPage()) break;
    page = (await page.getNextPage()) as PageLike;
  }
}

/**
 * Execute a method.
 *
 * When stream=true: returns an AsyncGenerator directly (not wrapped in Promise).
 *   Use: `for await (const item of execute(method, req, {stream:true}))`
 *
 * When stream=false/default: returns Promise<unknown>.
 *   - Pageable results are collected into a flat array.
 *   - Non-pageable results are returned as-is.
 *
 * Let SquareError-shaped throws propagate.
 */
export function execute(
  method: MethodEntry,
  request: object,
  options: ExecuteOptions
): AsyncGenerator<unknown> | Promise<unknown> {
  if (options.stream) {
    return (async function* () {
      const result = await Promise.resolve(method.fn(request));
      if (isPage(result)) {
        yield* streamPages(result);
      } else {
        yield result;
      }
    })();
  }

  return (async () => {
    const result = await Promise.resolve(method.fn(request));
    if (isPage(result)) {
      return collectPages(result);
    }
    return result;
  })();
}
