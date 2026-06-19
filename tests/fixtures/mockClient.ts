/**
 * mockClient.ts - Fake SquareClient-like object for testing
 * Uses prototype getters to mimic the real SDK's lazy getter pattern.
 */

export class MockSquareError extends Error {
  statusCode: number;
  errors: { category: string; code: string; detail?: string }[];

  constructor(
    statusCode: number,
    errors: { category: string; code: string; detail?: string }[]
  ) {
    super(`Square API error: ${statusCode}`);
    this.name = "SquareError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// Fake Page (async-iterable) that spans two pages
function makeFakePage(items: unknown[], pageSize = 2) {
  let page = 0;
  const pages = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }

  function makeSinglePage(idx: number): any {
    const pageData = pages[idx] ?? [];
    return {
      data: pageData,
      hasNextPage() {
        return idx + 1 < pages.length;
      },
      getNextPage() {
        return Promise.resolve(makeSinglePage(idx + 1));
      },
      [Symbol.asyncIterator]() {
        let itemIdx = 0;
        return {
          next: async () => {
            if (itemIdx < pageData.length) {
              return { value: pageData[itemIdx++], done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  return makeSinglePage(page);
}

// ---- terminal.actions sub-namespace ----
class MockTerminalActionsClient {
  // Internal/private dupe (should be skipped)
  __list() {
    return Promise.resolve(null);
  }

  list(request: unknown = {}) {
    return Promise.resolve(
      makeFakePage([
        { id: "a1", type: "SAVE_CARD" },
        { id: "a2", type: "SAVE_CARD" },
        { id: "a3", type: "SAVE_CARD" },
      ])
    );
  }

  create(request: unknown) {
    return Promise.resolve({ action: { id: "new-action" } });
  }
}

// ---- terminal namespace ----
class MockTerminalClient {
  // Internal/private method (should be skipped)
  _internalHelper() {}

  get actions(): MockTerminalActionsClient {
    return new MockTerminalActionsClient();
  }
}

// ---- payments namespace ----
class MockPaymentsClient {
  // BigInt fields to test serialization
  private _items = [
    { id: "pay1", amount_money: { amount: BigInt(100), currency: "USD" } },
    { id: "pay2", amount_money: { amount: BigInt(200), currency: "USD" } },
    { id: "pay3", amount_money: { amount: BigInt(300), currency: "USD" } },
  ];

  // Private dupe - should be skipped
  __list() {}
  __create() {}

  list(request: unknown = {}) {
    return Promise.resolve(makeFakePage(this._items));
  }

  create(request: unknown) {
    return Promise.resolve({ payment: { id: "new-pay", ...((request as any) ?? {}) } });
  }

  // A method that throws a SquareError
  throwingMethod(request: unknown = {}) {
    throw new MockSquareError(422, [
      { category: "INVALID_REQUEST_ERROR", code: "VALUE_EMPTY", detail: "amount is required" },
    ]);
  }
}

// ---- locations namespace (no sub-namespaces, just methods) ----
class MockLocationsClient {
  list(request: unknown = {}) {
    return Promise.resolve({ locations: [{ id: "L1", name: "Main" }] });
  }

  get(request: unknown) {
    return Promise.resolve({ location: { id: "L1", name: "Main" } });
  }
}

// ---- Root mock client ----
class MockSquareClientProto {
  // Constructor should be skipped by introspect
  constructor() {}

  // Private/underscore members - should be skipped
  _privateMethod() {}
  __doThing() {}

  get payments(): MockPaymentsClient {
    return new MockPaymentsClient();
  }

  get locations(): MockLocationsClient {
    return new MockLocationsClient();
  }

  get terminal(): MockTerminalClient {
    return new MockTerminalClient();
  }
}

export function createMockClient(): MockSquareClientProto {
  return new MockSquareClientProto();
}

export { makeFakePage };
