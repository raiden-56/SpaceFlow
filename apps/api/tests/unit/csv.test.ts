import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/modules/admin/workplace.js';

describe('parseCsv', () => {
  it('parses headers, quoted fields, escaped quotes and a BOM', () => {
    const text = '﻿code,name,amenities\nA-1,"Desk, window","monitor;docking"\nA-2,"Say ""hi""",\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      { code: 'A-1', name: 'Desk, window', amenities: 'monitor;docking' },
      { code: 'A-2', name: 'Say "hi"', amenities: '' },
    ]);
  });

  it('handles CRLF, blank lines and trims values', () => {
    const rows = parseCsv('code, name\r\n B-1 , Desk B \r\n\r\n');
    expect(rows).toEqual([{ code: 'B-1', name: 'Desk B' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
