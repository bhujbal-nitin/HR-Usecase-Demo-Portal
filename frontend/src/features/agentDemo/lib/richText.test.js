import { describe, expect, it } from 'vitest';
import { inline, parseRich, sentences, structure } from './richText';

describe('parseRich', () => {
  it('turns "- " lines into one bullet list and keeps paragraphs apart', () => {
    const blocks = parseRich('The leave policy includes:\n\n- First point.\n\n- Second **point**.\n\nA closing line.');
    expect(blocks.map((b) => b.type)).toEqual(['p', 'ul', 'p']);
    expect(blocks[0].lead).toBe(true);
    expect(blocks[1].items).toHaveLength(2);
    expect(blocks[1].items[1]).toEqual([{ text: 'Second ' }, { text: 'point', bold: true }, { text: '.' }]);
    expect(blocks[2].lead).toBe(false);
  });

  it('reads numbered lists and * or • bullets', () => {
    expect(parseRich('1. One\n2) Two')).toEqual([{ type: 'ol', items: [[{ text: 'One' }], [{ text: 'Two' }]] }]);
    expect(parseRich('* a\n• b')[0]).toMatchObject({ type: 'ul' });
    expect(parseRich('* a\n• b')[0].items).toHaveLength(2);
  });

  it('starts a new list when the kind changes', () => {
    expect(parseRich('- a\n1. b').map((b) => b.type)).toEqual(['ul', 'ol']);
  });

  it('shows a plain answer as a single paragraph and survives empty input', () => {
    expect(parseRich('Just a sentence.')).toEqual([{ type: 'p', parts: [{ text: 'Just a sentence.' }], lead: false }]);
    expect(parseRich('')).toEqual([]);
    expect(parseRich(undefined)).toEqual([]);
  });

  it('never treats markup as anything but text', () => {
    expect(inline('<b>x</b> **y**')).toEqual([{ text: '<b>x</b> ' }, { text: 'y', bold: true }]);
  });
});

describe('structure', () => {
  const answer = 'The policy provides maternity benefits. She is entitled to 182 days of leave. It applies to all women at ValueDX Technologies Pvt Ltd. Working hours are 9:30 a.m. to 6:30 p.m.';

  it('splits a plain paragraph into bullets without breaking after abbreviations', () => {
    expect(sentences(answer)).toHaveLength(4);
    const [list] = structure(answer);
    expect(list.type).toBe('ul');
    expect(list.items).toHaveLength(4);
  });

  it('bolds the figures', () => {
    const [list] = structure(answer);
    expect(list.items[1]).toContainEqual({ text: '182 days', bold: true });
  });

  it('leaves answers that already have structure, and one-sentence answers, alone', () => {
    const text = ['Intro:', '', '- a', '- b'].join('\n');
    expect(structure(text)).toEqual(parseRich(text));
    expect(structure('Just one sentence.')[0].type).toBe('p');
  });
});
