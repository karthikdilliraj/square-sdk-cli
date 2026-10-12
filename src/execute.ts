/**
 * execute.ts - Execute a resolved SDK method, handling paging and streaming.
 */

import type { MethodEntry } from "./introspect.ts";

export interface ExecuteOptions {
  stream?: boolean;
  /** Stop after this many items across all pages. */
  maxItems?: number;
  /** Stop after fetching this many pages. */
  maxPages?: number;
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
 * Async generator that yields items from all pages, honoring item/page limits.
 * The next page is only fetched when more items are still wanted.
 */
async function* iteratePages(firstPage: PageLike, options: ExecuteOptions): AsyncGenerator<unknown> {
  const { maxItems, maxPages } = options;
  let page: PageLike = firstPage;
  let pages = 1;
  let items = 0;
  while (true) {
    for (const item of page.data) {
      if (maxItems !== undefined && items >= maxItems) return;
      yield item;
      items++;
    }
    if (!page.hasNextPage()) return;
    if (maxPages !== undefined && pages >= maxPages) return;
    if (maxItems !== undefined && items >= maxItems) return;
    page = (await page.getNextPage()) as PageLike;
    pages++;
  }
}

/**
 * Collect pages into a flat array, honoring item/page limits.
 */
async function collectPages(firstPage: PageLike, options: ExecuteOptions): Promise<unknown[]> {
  const results: unknown[] = [];
  for await (const item of iteratePages(firstPage, options)) results.push(item);
  return results;
}

/**
 * Execute a method.
 *
 * When stream=true: returns an AsyncGenerator directly (not wrapped in Promise).
 *   Use: `for await (const item of execute(method, req, {stream:true}))`
 *
 * When stream=false/default: returns Promise<unknown>.
 *   - Pageable results are collected into a flat array.
 *   - maxItems / maxPages cap paging in both modes.
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
        yield* iteratePages(result, options);
      } else {
        yield result;
      }
    })();
  }

  return (async () => {
    const result = await Promise.resolve(method.fn(request));
    if (isPage(result)) {
      return collectPages(result, options);
    }
    return result;
  })();
}
