'use client';

import { useMemo, useRef, useState } from 'react';
import { parseReport, mergeResults, normalizeName } from '../lib/parse.js';
import {
  formatRotina,
  formatMensalao,
  formatPrisma,
  formatTubulopatias,
} from '../lib/format.js';
import {
  parseImagingConclusions,
  formatImaging,
  mergeImaging,
} from '../lib/imaging.js';

// ---------- extração de PDF 100% local (pdf.js) ----------

async function extractPdfText(arrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // reconstrói linhas pela coordenada Y
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], str: it.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(' ')
      );
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n');
}

function fileToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ---------- exemplo sintético (paciente fictício) ----------

const SAMPLE = `LABORATORIO EXEMPLO LTDA
Paciente: PACIENTE EXEMPLO DA SILVA   Convênio: TESTE   DN: 01/01/2000
Coletado em: 10/08/2026 às 07:15

HEMOGRAMA COMPLETO - Material: Sangue total
Hemoglobina .......... 11,2 g/dL      VR: 12,0 a 16,0
Hematócrito .......... 34,5 %         VR: 36,0 a 47,0
VCM .................. 88,0 fL
Leucócitos ........... 6.840 /mm³
  Segmentados ........ 62,0 %   4.240 /mm³
  Linfócitos ......... 26,0 %   1.778 /mm³
  Monócitos .......... 8,0 %
  Eosinófilos ........ 3,0 %
  Basófilos .......... 1,0 %
Plaquetas ............ 245.000 /mm³

BIOQUÍMICA - Material: Soro
Ureia ................ 52 mg/dL       VR: 10 a 50
Creatinina ........... 1,4 mg/dL
Sódio ................ 138 mEq/L
Potássio ............. 4,7 mEq/L
Magnésio ............. 2,1 mg/dL
Cloro ................ 104 mEq/L
Cálcio total ......... 9,1 mg/dL
Fósforo .............. 4,2 mg/dL
Cálcio iônico ........ 4,9 mg/dL
Glicose .............. 92 mg/dL
Proteínas totais ..... 6,8 g/dL
Albumina ............. 3,9 g/dL
TGO (AST) ............ 28 U/L
TGP (ALT) ............ 31 U/L
Proteína C Reativa ... 0,4 mg/dL

Coletado em: 10/08/2026 às 16:40
GASOMETRIA VENOSA - Material: Sangue venoso
pH ................... 7,32
pCO2 ................. 44,0 mmHg
pO2 .................. 38,0 mmHg
HCO3 ................. 21,8 mEq/L
BE ................... -3,1
Saturação de O2 ...... 68,0 %
Lactato .............. 1,4 mmol/L

LABORATORIO EXEMPLO - SETOR DE DIAGNÓSTICO POR IMAGEM
Paciente: PACIENTE EXEMPLO DA SILVA
Data do exame: 11/08/2026

ULTRASSONOGRAFIA DE ABDOME TOTAL
Técnica: exame realizado com transdutor convexo multifrequencial.
Fígado de dimensões normais, contornos regulares, ecotextura preservada.
Vesícula biliar normodistendida, sem cálculos. Rins tópicos, sem dilatação.

CONCLUSÃO:
Exame ultrassonográfico do abdome dentro dos limites da normalidade.
Ausência de líquido livre na cavidade.

Dr. Radiologista Exemplo - CRM 00000`;

// ---------- componente ----------

let nextId = 1;

export default function Home() {
  const [sources, setSources] = useState([]); // {id, label, kind, text, parsed}
  const [pasteText, setPasteText] = useState('');
  const [format, setFormat] = useState('rotina');
  const [confirmedName, setConfirmedName] = useState(null);
  const [manualName, setManualName] = useState('');
  const [busy, setBusy] = useState(null); // label do arquivo em processamento
  const [apiError, setApiError] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);

  // ---- derivações ----
  const detectedNames = useMemo(() => {
    const map = new Map(); // normalizado -> original
    for (const s of sources) {
      if (s.parsed.patientName) {
        map.set(normalizeName(s.parsed.patientName), s.parsed.patientName);
      }
    }
    return [...map.values()];
  }, [sources]);

  const nameConflict = detectedNames.length > 1;

  const activeName =
    confirmedName ??
    null; /* saída só é liberada após confirmação explícita */

  const merged = useMemo(
    () => mergeResults(sources.map((s) => s.parsed)),
    [sources]
  );

  const mergedImaging = useMemo(
    () => mergeImaging(sources.map((s) => s.parsed.imaging || [])),
    [sources]
  );

  const output = useMemo(() => {
    if (!activeName || nameConflict) return '';
    if (format === 'imagem') {
      return mergedImaging.length > 0 ? formatImaging(mergedImaging) : '';
    }
    if (merged.length === 0) return '';
    if (format === 'prisma') return formatPrisma(merged);
    if (format === 'tubulo') return formatTubulopatias(merged);
    return format === 'rotina' ? formatRotina(merged) : formatMensalao(merged);
  }, [activeName, nameConflict, merged, mergedImaging, format]);

  const warnings = useMemo(() => {
    const all = [];
    for (const s of sources) {
      for (const w of s.parsed.warnings) all.push(`${s.label}: ${w}`);
    }
    return all;
  }, [sources]);

  // ---- ações ----

  function invalidateConfirmation() {
    setConfirmedName(null);
    setCopied(false);
  }

  function addTextSource(label, kind, text) {
    const parsed = parseReport(text);
    const imaging = parseImagingConclusions(text);
    parsed.imaging = imaging.items;
    parsed.warnings.push(...imaging.warnings);
    setSources((prev) => [...prev, { id: nextId++, label, kind, text, parsed }]);
    invalidateConfirmation();
  }

  function handleAddPaste() {
    if (!pasteText.trim()) return;
    addTextSource(`Texto colado #${sources.length + 1}`, 'texto', pasteText);
    setPasteText('');
  }

  function handleLoadSample() {
    addTextSource('Exemplo sintético', 'texto', SAMPLE);
  }

  function removeSource(id) {
    setSources((prev) => prev.filter((s) => s.id !== id));
    invalidateConfirmation();
  }

  async function sendToApi(label, mediaType, base64) {
    setBusy(label);
    setApiError(null);
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: mediaType, data: base64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erro ${res.status}`);
      addTextSource(`${label} (via Claude)`, 'api', json.text);
      if (json.truncated) {
        setApiError(
          `${label}: a transcrição pode ter sido truncada (documento muito longo).`
        );
      }
    } catch (err) {
      setApiError(`${label}: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleFiles(fileList) {
    setApiError(null);
    for (const file of Array.from(fileList)) {
      const label = file.name;
      const buf = await file.arrayBuffer();

      if (file.type === 'application/pdf') {
        setBusy(label);
        let text = '';
        try {
          text = await extractPdfText(buf.slice(0));
        } catch {
          /* PDF corrompido ou protegido — tenta via API abaixo */
        }
        setBusy(null);
        if (text.replace(/\s/g, '').length > 60) {
          // PDF com camada de texto: processamento 100% local
          addTextSource(label, 'pdf', text);
        } else {
          // PDF escaneado (imagem): precisa da API
          const ok = window.confirm(
            `"${label}" parece ser um PDF escaneado (sem camada de texto).\n\n` +
              'Para transcrevê-lo é necessário enviá-lo à API da Anthropic (dados saem do computador).\n\nEnviar?'
          );
          if (ok) await sendToApi(label, 'application/pdf', fileToBase64(buf));
        }
      } else if (file.type.startsWith('image/')) {
        const ok = window.confirm(
          `Imagens só podem ser transcritas via API da Anthropic (dados saem do computador).\n\nEnviar "${label}"?`
        );
        if (ok) await sendToApi(label, file.type, fileToBase64(buf));
      } else {
        // trata como texto puro
        const text = new TextDecoder('utf-8').decode(buf);
        addTextSource(label, 'texto', text);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canConfirm = detectedNames.length === 1 || manualName.trim().length > 3;

  // ---- render ----

  return (
    <div className="wrap">
      <header className="app">
        <img
          src="/logo-icr.jpg"
          alt="Instituto da Criança"
          className="logo"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <div>
          <h1>Transcritor de Exames</h1>
          <p>
            Texto e PDFs são processados <b>100% no seu computador</b> —
            nada sai daqui. Apenas fotos e PDFs escaneados (se você aceitar)
            usam o servidor externo da Anthropic.
          </p>
        </div>
      </header>

      {/* 1. ENTRADAS */}
      <section className="card">
        <h2>1 · Laudos do paciente</h2>
        <textarea
          className="paste"
          placeholder="Cole aqui o texto do laudo (Ctrl+V)..."
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <div className="row">
          <button className="primary" onClick={handleAddPaste} disabled={!pasteText.trim()}>
            Adicionar texto
          </button>
          <label className="filelabel">
            + PDF ou imagem
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,image/*"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
          <button className="small" onClick={handleLoadSample}>
            Carregar exemplo
          </button>
          {busy && <span className="muted">Processando {busy}…</span>}
        </div>
        <p className="privacy">
          <b>Privacidade:</b> nada é enviado para fora do computador sem sua
          confirmação explícita (apenas imagens/PDFs escaneados, se você
          aceitar).
        </p>

        {apiError && <div className="banner error" style={{ marginTop: 12 }}>{apiError}</div>}

        {sources.length > 0 && (
          <ul className="sources">
            {sources.map((s) => (
              <li key={s.id}>
                <span>{s.label}</span>
                <span className="chip">{s.kind}</span>
                {s.parsed.patientName ? (
                  <span className="chip name">{s.parsed.patientName}</span>
                ) : (
                  <span className="chip none">nome não encontrado</span>
                )}
                <span className="count">
                  {s.parsed.results.length} exame(s)
                  {(() => {
                    const gen = s.parsed.results.filter((r) =>
                      r.id.startsWith('GEN:')
                    ).length;
                    const uri = s.parsed.results.filter((r) => r.urine).length;
                    return (
                      (gen ? ` · ${gen} fora do modelo` : '') +
                      (uri ? ` · ${uri} urinário(s)` : '')
                    );
                  })()}
                  {s.parsed.imaging?.length
                    ? ` · ${s.parsed.imaging.length} laudo(s) de imagem`
                    : ''}
                </span>
                <span className="spacer" />
                <button className="small danger" onClick={() => removeSource(s.id)}>
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. VALIDAÇÃO DO PACIENTE */}
      {sources.length > 0 && (
        <section className="card">
          <h2>2 · Confirmação do paciente</h2>

          {nameConflict ? (
            <div className="banner error">
              <b>Bloqueado:</b> os laudos adicionados pertencem a pacientes
              diferentes ({detectedNames.join(' × ')}). Remova os arquivos que
              não são deste paciente antes de continuar.
            </div>
          ) : confirmedName ? (
            <div className="banner confirm">
              ✓ Paciente confirmado: <strong>{confirmedName}</strong>
              <button className="small" onClick={() => setConfirmedName(null)}>
                alterar
              </button>
            </div>
          ) : (
            <div className="banner confirm">
              {detectedNames.length === 1 ? (
                <>
                  Paciente detectado: <strong>{detectedNames[0]}</strong>
                  <button
                    className="primary"
                    onClick={() => setConfirmedName(detectedNames[0])}
                  >
                    Confirmar paciente
                  </button>
                </>
              ) : (
                <>
                  Nome não detectado — digite para confirmar:
                  <input
                    type="text"
                    placeholder="NOME COMPLETO DO PACIENTE"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={!canConfirm}
                    onClick={() =>
                      setConfirmedName(manualName.trim().toUpperCase())
                    }
                  >
                    Confirmar paciente
                  </button>
                </>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="banner warn">
              {warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 3. SAÍDA */}
      {sources.length > 0 && (
        <section className="card">
          <div className="outhead">
            <h2 style={{ margin: 0 }}>3 · Transcrição</h2>
            <div className="toggle">
              <button
                className={format === 'rotina' ? 'active' : ''}
                onClick={() => setFormat('rotina')}
              >
                ROTINA
              </button>
              <button
                className={format === 'mensalao' ? 'active' : ''}
                onClick={() => setFormat('mensalao')}
              >
                MENSALÃO
              </button>
              <button
                className={format === 'prisma' ? 'active' : ''}
                onClick={() => setFormat('prisma')}
                title="Terapia contínua com citrato: CaI/CaM em mmol/L e relação CaT/CaI"
              >
                PRISMA
              </button>
              <button
                className={format === 'tubulo' ? 'active' : ''}
                onClick={() => setFormat('tubulo')}
                title="Investigação tubular: componentes urinários, relações e gradientes com a conta armada"
              >
                TUBULOPATIAS
              </button>
              <button
                className={format === 'imagem' ? 'active' : ''}
                onClick={() => setFormat('imagem')}
              >
                IMAGEM
              </button>
            </div>
            <span className="spacer" />
            <button className="primary" onClick={handleCopy} disabled={!output}>
              Copiar
            </button>
            {copied && <span className="copied">copiado ✓</span>}
          </div>

          {!confirmedName && !nameConflict ? (
            <p className="muted">
              Confirme o paciente acima para liberar a transcrição.
            </p>
          ) : nameConflict ? (
            <p className="muted">Resolva o conflito de pacientes acima.</p>
          ) : output === '' ? (
            <p className="muted">
              {format === 'imagem'
                ? 'Nenhuma conclusão de laudo de imagem reconhecida nas fontes adicionadas.'
                : format === 'tubulo'
                  ? 'Nenhuma dosagem urinária/tubular reconhecida nas fontes adicionadas.'
                  : 'Nenhum exame reconhecido nas fontes adicionadas.'}
            </p>
          ) : (
            <pre className="output">{output}</pre>
          )}
        </section>
      )}
    </div>
  );
}
