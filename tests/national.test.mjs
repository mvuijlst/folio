import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../national.js';

test('which catalogue an ISBN group goes to', () => {
  assert.equal(N.nationalFor('9789021015996'), 'kb');
  assert.equal(N.nationalFor('9789401403665'), 'kb');
  assert.equal(N.nationalFor('9782070612888'), 'bnf');
  assert.equal(N.nationalFor('9791032100000'), 'bnf');
  assert.equal(N.nationalFor('9780141439518'), '');
  assert.equal(N.nationalFor('9783426281550'), '');   // the DNB is not asked (it refuses browsers)
});

test('ISBN-10 for older records', () => {
  assert.equal(N.isbn10('9789021015996'), '9021015994');
  assert.equal(N.isbn10('9789070443352'), '907044335X');
  assert.equal(N.isbn10('9791032100000'), '');
});

test('the KB query asks both forms, and its answer is read', () => {
  assert.match(N.kbQuery('9789021015996'), /VALUES \?isbn \{ "9789021015996" "9021015994" \}/);
  const json = { results: { bindings: [
    { name: { value: 'De historicus' }, pages: { value: '709' }, lang: { value: 'nl' }, publisher: { value: 'Poema Pocket' }, year: { value: '2011' }, author: { value: 'Elizabeth Johnson Kostova' } },
    { name: { value: 'De historicus' }, author: { value: 'Elizabeth Johnson Kostova' } },
  ] } };
  assert.deepEqual(N.fromKb(json), { title: 'De historicus', author: 'Elizabeth Johnson Kostova', publisher: 'Poema Pocket', date: '2011', pages: 709, language: 'nl' });
  assert.equal(N.fromKb({ results: { bindings: [] } }), null);
});

test('a BnF UNIMARC record is read', () => {
  const xml = `<srw:searchRetrieveResponse><srw:numberOfRecords>1</srw:numberOfRecords><srw:records><srw:record><srw:recordData>
  <mxc:record format="Unimarc">
    <mxc:datafield tag="101" ind1="0" ind2=" "><mxc:subfield code="a">fre</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="200" ind1="1" ind2=" "><mxc:subfield code="a">Le seigneur des anneaux</mxc:subfield><mxc:subfield code="b">Texte imprimé</mxc:subfield><mxc:subfield code="h">1</mxc:subfield><mxc:subfield code="i">La communauté de l'anneau</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="210" ind1=" " ind2=" "><mxc:subfield code="a">Paris</mxc:subfield><mxc:subfield code="c">Gallimard-Jeunesse</mxc:subfield><mxc:subfield code="d">2007</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="215" ind1=" " ind2=" "><mxc:subfield code="a">1 vol. (687 p.)</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="700" ind1=" " ind2="|"><mxc:subfield code="a">Tolkien</mxc:subfield><mxc:subfield code="b">John Ronald Reuel</mxc:subfield><mxc:subfield code="4">070</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="702" ind1=" " ind2="|"><mxc:subfield code="a">Ledoux</mxc:subfield><mxc:subfield code="b">Francis</mxc:subfield></mxc:datafield>
  </mxc:record></srw:recordData></srw:record></srw:records></srw:searchRetrieveResponse>`;
  assert.deepEqual(N.fromBnf(xml), {
    title: 'Le seigneur des anneaux. 1, La communauté de l\'anneau', author: 'John Ronald Reuel Tolkien',
    publisher: 'Gallimard-Jeunesse', date: '2007', pages: 687, language: 'fr',
  });
  assert.equal(N.fromBnf('<srw:numberOfRecords>0</srw:numberOfRecords>'), null);
});

test('the national record wins on publisher, year, pages and language, not on title and writers', () => {
  const merged = { title: 'De historicus', author: 'Elizabeth Kostova', publisher: 'Poema', date: '2008-03-01', pages: 700, cover: 'x.jpg', language: '' };
  const kb = { title: 'De historicus', author: 'Elizabeth Johnson Kostova', publisher: 'Poema Pocket', date: '2011', pages: 709, language: 'nl' };
  assert.deepEqual(N.withNational(merged, kb), { ...merged, publisher: 'Poema Pocket', date: '2011', pages: 709, language: 'nl' });
  assert.deepEqual(N.withNational({ title: '', author: '', cover: '' }, kb).author, 'Elizabeth Johnson Kostova');   // nobody else knows it
  assert.equal(N.withNational(merged, null), merged);
});
