import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { db } from '../storage/db';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(() => {
  // cada prueba restaura sus propios mocks
});
