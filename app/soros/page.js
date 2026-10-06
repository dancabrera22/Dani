'use client';

import { useMemo, useState } from 'react';
import { COMPONENTES, calcularSoro, hollidaySegar, fmt } from '../../lib/solucoes.js';

const GRUPOS = [
  ['glicose', 'Glicose'],
  ['eletrolito', 'Eletrólitos'],
  ['diluente', 'Diluentes'],
];

let linhaId = 1;

export default function Soros() {
  const [peso, setPeso] = useState('');
  const [horas, setHoras] = useState('24');
  const [volumeTotal, setVolumeTotal] = useState('');
  const [itens, setItens] = useState([
    { key: linhaId++, id: 'SG10', ml: '' },
    { key: linhaId++, id: 'NaCl20', ml: '' },
  ]);
  const [copiado, setCopiado] = useState(false);

  const r = useMemo(
    () => calcularSoro(itens, { peso, horas, volumeTotal }),
    [itens, peso, horas, volumeTotal]
  );

  const temDados = Number(peso) > 0 && r.volumeTotal > 0;

  function mudar(key, campo, valor) {
    setItens((prev) => prev.map((i) => (i.key === key ? { ...i, [campo]: valor } : i)));
    setCopiado(false);
  }
  function adicionar() {
    setItens((prev) => [...prev, { key: linhaId++, id: 'KCl191', ml: '' }]);
  }
  function remover(key) {
    setItens((prev) => prev.filter((i) => i.key !== key));
  }

  const resumo = useMemo(() => {
    if (!temDados) return '';
    const l = [];
    l.push(
      `Soro ${fmt(r.volumeTotal)} mL em ${fmt(r.horas)} h (${fmt(r.taxa)} mL/h) — ${fmt(peso)} kg`
    );
    l.push(`Oferta hídrica ${fmt(r.ofertaHidrica)} mL/kg/dia`);
    l.push(`Glicose ${fmt(r.glicosePct)}% · VIG ${fmt(r.vig)} mg/kg/min`);
    // Na e K: concentração da solução vem primeiro (tonicidade)
    for (const k of ['Na', 'K']) {
      if (r.ions[k] > 0) {
        l.push(
          `${k} ${fmt(r.porLitro[k])} mEq/L (${fmt(r.porKg[k])} mEq/kg/dia · ` +
            `${fmt(r.por100kcal[k])} mEq/100 kcal)`
        );
      }
    }
    const outros = ['Cl', 'Ca', 'Mg', 'HCO3']
      .filter((k) => r.ions[k] > 0)
      .map((k) => `${k} ${fmt(r.porKg[k])}`)
      .join(' ');
    if (outros) l.push(`mEq/kg/dia: ${outros}`);
    if (r.ions.P > 0) l.push(`P ${fmt(r.porKg.P)} mmol/kg/dia`);
    l.push(`Osmolaridade ${fmt(r.osmolaridade)} mOsm/L (${r.acessoSugerido})`);
    return l.join('\n');
  }, [r, peso, temDados]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(resumo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {}
  }

  return (
    <div className="wrap">
      <header className="app">
        <div>
          <h1>Calculadora de Soros</h1>
          <p>
            Confere um soro já prescrito: oferta hídrica, VIG, eletrólitos por
            kg/dia e por 100 kcal, osmolaridade. <b>Nenhum dado de paciente</b> —
            só peso e volumes, tudo no seu computador.
          </p>
        </div>
      </header>

      <section className="card">
        <h2>1 · Paciente e infusão</h2>
        <div className="row measures">
          <label>
            Peso{' '}
            <input type="number" min="0" step="0.01" value={peso}
              onChange={(e) => setPeso(e.target.value)} placeholder="kg" />
          </label>
          <label>
            Correr em{' '}
            <input type="number" min="1" step="1" value={horas}
              onChange={(e) => setHoras(e.target.value)} placeholder="h" />
          </label>
          <label>
            Volume total{' '}
            <input type="number" min="0" step="1" value={volumeTotal}
              onChange={(e) => setVolumeTotal(e.target.value)} placeholder="mL (opcional)" />
          </label>
          <span className="muted">
            {Number(peso) > 0
              ? `Holliday-Segar: ${fmt(hollidaySegar(peso))} kcal/dia`
              : 'Volume total em branco = soma dos componentes; se maior, completa com água destilada.'}
          </span>
        </div>
      </section>

      <section className="card">
        <h2>2 · Componentes</h2>
        <ul className="sources">
          {itens.map((i) => (
            <li key={i.key}>
              <select value={i.id} onChange={(e) => mudar(i.key, 'id', e.target.value)}>
                {GRUPOS.map(([g, rotulo]) => (
                  <optgroup key={g} label={rotulo}>
                    {COMPONENTES.filter((c) => c.grupo === g).map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input type="number" min="0" step="0.1" value={i.ml}
                onChange={(e) => mudar(i.key, 'ml', e.target.value)} placeholder="mL" />
              <span className="spacer" />
              <button className="small danger" onClick={() => remover(i.key)}>remover</button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button onClick={adicionar}>+ componente</button>
          {r.volAD > 0 && (
            <span className="muted">
              + {fmt(r.volAD)} mL de água destilada para completar {fmt(r.volumeTotal)} mL
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>3 · Resultado</h2>
        {!temDados ? (
          <p className="muted">Informe o peso e ao menos um componente com volume.</p>
        ) : (
          <>
            <div className="outhead">
              <button className="primary" onClick={copiar}>Copiar</button>
              {copiado && <span className="copied">copiado ✓</span>}
            </div>
            <pre className="output">{resumo}</pre>

            <details className="formulas" style={{ marginTop: 14 }}>
              <summary>Como cheguei nesses números</summary>
              <div className="fgroup">
                <ul>
                  <li>
                    <b>Oferta hídrica</b>{' '}
                    <code>{fmt(r.volumeTotal)} ÷ {fmt(peso)} = {fmt(r.ofertaHidrica)} mL/kg/dia</code>
                  </li>
                  <li>
                    <b>VIG</b>{' '}
                    <code>
                      ({fmt(r.glicosePct)}% × {fmt(r.taxa)} mL/h) ÷ (6 × {fmt(peso)}) = {fmt(r.vig)} mg/kg/min
                    </code>
                  </li>
                  <li>
                    <b>Glicose final</b>{' '}
                    <code>{fmt(r.glicoseG)} g ÷ {fmt(r.volumeTotal)} mL = {fmt(r.glicosePct)}%</code>
                  </li>
                  {['Na', 'K', 'Cl', 'Ca', 'Mg', 'HCO3', 'P']
                    .filter((k) => r.ions[k] > 0)
                    .map((k) => (
                      <li key={k}>
                        <b>{k}</b>{' '}
                        <code>
                          {fmt(r.ions[k])} {k === 'P' ? 'mmol' : 'mEq'} ÷ {fmt(peso)} kg ={' '}
                          {fmt(r.porKg[k])} /kg/dia · {fmt(r.por100kcal[k])} /100 kcal
                        </code>
                      </li>
                    ))}
                  <li>
                    <b>Osmolaridade</b>{' '}
                    <code>
                      {fmt(r.osmolaridade)} mOsm/L → acesso {r.acessoSugerido}
                      {r.osmolaridade > 900 ? ' (acima de 900)' : ''}
                    </code>
                  </li>
                </ul>
              </div>
              <div className="fgroup">
                <h3>Contribuição de cada componente</h3>
                <ul>
                  {r.contas.map((c, i) => (
                    <li key={i}><code>{c}</code></li>
                  ))}
                </ul>
              </div>
            </details>
          </>
        )}
      </section>

      <section className="card">
        <p className="muted">
          Confira sempre contra a prescrição. Concentrações validadas com as
          apresentações do serviço; fósforo sempre em mmol.
        </p>
      </section>
    </div>
  );
}
