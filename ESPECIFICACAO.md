# Especificação — Transcritor de Exames Laboratoriais

> Documento autossuficiente para (re)construir a plataforma do zero em
> qualquer sessão/máquina. Contém o pedido original, todas as decisões
> tomadas, o desenho técnico e os casos de teste com saída esperada.

---

## 1. Objetivo

Plataforma **Next.js, local, sem backend externo** (`npm run dev`), que
transcreve exames laboratoriais enviados por **texto colado, PDF ou imagem**
estritamente em dois modelos de saída (abaixo). Usuária: médica nefrologista
pediátrica; os laudos são de laboratórios brasileiros (pt-BR, vírgula
decimal, ponto de milhar).

## 2. Regras obrigatórias (do pedido original — imutáveis)

1. **Validar o NOME DO PACIENTE antes de transcrever.** Nunca misturar exames
   de pacientes ou arquivos diferentes.
2. **Agrupar estritamente por DATA e HORÁRIO de coleta.** Horários diferentes
   no mesmo dia ⇒ uma linha/bloco para cada horário.
3. **Não adicionar saudações, resumos clínicos, tabelas ou comentários.**
   Retornar APENAS o texto no modelo solicitado.

### Formato 1 — MODELO ROTINA

```
MODELO ROTINA DD/MM/AA (HH:MM): Ur [val] Cr [val] AU [val] pH [val] pCO2 [val] pO2 [val] HCO3 [val] BE [val] SatO2 [val]% Lact [val] Glic [val] Na [val] K [val] Mg [val] Cl [val] Ca [val] P [val] CaI [val] Hb [val] Ht [val]% Plaq [val]mil Leuco [val]mil (N [val]% L [val]% M [val]% E [val]% B [val]%) e demais exames com mesmo estilo de digitação PT [val] Alb [val] etc
```

### Formato 2 — MODELO MENSALÃO

```
MODELO MENSALÃO DD/MM/AA (HH:MM):
DD/MM/AA: TSH [val] T4L [val] PTH [val]
DD/MM/AA: Ferro [val] Transf [val] SatTransf [val]% Ferritina [val] TIBC [val]
DD/MM/AA: CT [val] HDL [val] LDL [val] VLDL [val] Não-HDL [val] Trig [val]
DD/MM/AA: Ur [val] Cr [val]
DD/MM/AA: PCR [val]
DD/MM/AA: TGO [val] TGP [val]
DD/MM/AA: PT [val] Alb [val]
DD/MM/AA: pH [val] pCO2 [val] pO2 [val] HCO3 [val] BE [val] SatO2 [val]% Lact [val] Glic [val]
DD/MM/AA: Na [val] K [val] Mg [val] Cl [val]
DD/MM/AA: Ca [val] P [val] CaI [val]
DD/MM/AA: Hb [val] Ht [val]% VCM [val]
DD/MM/AA: Leuco [val] (N [val]% L [val]% M [val]% E [val]% B [val]%) Plaq [val]mil
DD/MM/AA: Ret [val]%
```

Cabeçalho do MENSALÃO usa a coleta mais recente; linhas agrupam por **dia**.
Exames fora do modelo entram como linhas extras ao final, mesmo estilo.

## 3. Decisões de produto (confirmadas pela usuária)

| Decisão | Escolha |
|---|---|
| Motor de transcrição | **Híbrido**: parser local determinístico para texto e PDF com camada de texto (nada sai da máquina); Claude API somente para imagem/PDF escaneado, usada apenas como OCR fiel — a formatação final é SEMPRE do parser local |
| Exame ausente no laudo | **Omitir o item** (sem marcadores; ex.: `Na 139 K 3,8 Cl 112` sem Mg) |
| Validação do paciente | **Confirmação obrigatória na tela**: nome extraído e exibido; nada é transcrito sem confirmação; fontes com nomes diferentes **bloqueiam** a saída |
| Envio à API | Sempre precedido de confirmação explícita do usuário (janela de confirmação) |
| Dados prévios | Nenhum dado real de paciente em código, fixtures ou testes — somente sintéticos fictícios |
| Futuro | Deixar espaço para backend: `lib/` deve ser puro/isomórfico; `app/api/` é o ponto de extensão (banco, histórico, login) |

### Por que Next.js (e não HTML offline)

HTML puro bastaria para texto colado, mas: (1) a chave da Anthropic ficaria
exposta no navegador e chamadas de `file://` esbarram em CORS — a rota
`app/api/transcribe` guarda a chave no servidor local via `.env.local`;
(2) `app/api/` já serve de backend embrionário para o roadmap.

## 4. Stack

- Next.js 15 (App Router, JS puro, `"type": "module"`), React 19
- `pdfjs-dist` ^4 — extração de PDF no navegador
  (worker via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`;
  linhas reconstruídas agrupando itens por Y arredondado e ordenando por X)
- `@anthropic-ai/sdk` — rota OCR; modelo `claude-opus-5`
  (`ANTHROPIC_MODEL` sobrescreve); `max_tokens: 16000`; entrada como bloco
  `image`/`document` base64; tratar `stop_reason === 'refusal'`; sem chave ⇒
  503 com mensagem amigável (app segue 100% offline)
- Sem TypeScript, sem Tailwind — CSS simples em `app/globals.css`

## 5. Arquitetura

```
lib/analytes.js   dicionário + ordens (ROTINA_CORE, DIFF_IDS, EXTRA_ORDER,
                  MENSALAO_LINES, PERCENT_IDS, IGNORE_PATTERNS, REF_CUT,
                  URINE_SECTION, BLOOD_SECTION)
lib/parse.js      normalize, parseNumberBR, extractPatientName,
                  parseReport(text) -> {patientName, results[], warnings[]},
                  mergeResults(sources) — dedup por (analito, data/hora),
                  primeira ocorrência vence
lib/format.js     formatRotina(results), formatMensalao(results)
app/page.js       'use client': fontes → confirmação → toggle ROTINA/MENSALÃO
                  → <pre> + botão Copiar; avisos fora do texto copiável
app/api/transcribe/route.js  POST {media_type, data(base64)} -> {text}
```

## 6. Regras do parser (essência do sistema)

1. **Normalização**: NFD sem diacríticos, minúsculas. Números:
   `4.960`→4960 (milhar); `7,35` e `7.35`→decimal. Saída sempre com vírgula.
2. **Nome do paciente**: linhas `Paciente:|Nome:|Nome do paciente:|Cliente:`
   nas ~120 primeiras linhas; cortar em rótulos seguintes (Convênio, RG, CPF,
   DN, Sexo…) e em colunas (2+ espaços); exigir ≥2 palavras alfabéticas;
   comparação entre fontes com nome normalizado (sem acento/caixa).
3. **Coleta**: linha contendo `colet` + data `DD/MM/AAAA` (+hora `HH:MM`
   opcional) atualiza o datetime corrente; analitos herdam o corrente.
   Nenhuma coleta no documento ⇒ grupo "SEM DATA" + aviso.
4. **Matching**: dicionário ordenado (específico → genérico); após match, o
   nome é **mascarado** (`\x00`) para não ser recapturado por padrão
   genérico. Padrões `near: true` (códigos curtos: Ur, Cr, Na, K, Ca, P, Hb,
   pH, BIC…) só casam se até o valor houver apenas separadores
   `[\s.:=]` — aceita líderes de pontos (`pH .... 7,32`), rejeita letras
   ("na coleta" ≠ Na).
5. **Busca do valor** (`findValue`): 1º número após o nome; gap não pode
   conter palavra estranha (exceto `resultado/valor` e unidades entre
   parênteses) nem região mascarada; números colados a `/` ou `:` são datas
   ⇒ pular; analitos `percent: true` preferem número seguido de `%`
   (diferencial mostra % e absoluto — pegar o %).
6. **Cortes**: linha truncada no 1º marcador de referência
   (`VR:`, `Valores de referência`, `Ref.:`, `Desejável`, `Nota:`, `Método:`…).
7. **Urina**: cabeçalhos de EAS/urina ligam skip até cabeçalho de
   sangue/soro/hemograma/gasometria (protege pH sérico).
8. **Dedup**: chave `analito|data|hora` — primeira ocorrência vence, dentro
   da fonte e entre fontes. Limitação conhecida: ureia pré/pós-diálise no
   MESMO horário mantém só a primeira (horários distintos ok).
9. **Conversões**: Plaq sempre `mil` (bruto >10000 ÷1000; `45.000`→`45mil`);
   Leuco na ROTINA em `mil` (`6.840`→`6,84mil`), no MENSALÃO absoluto
   (`4,96`→`4960`).

### Armadilhas mapeadas (tabela de regressão)

| Armadilha | Solução |
|---|---|
| `Hemoglobina glicada (HbA1c) 5,4%` contaminaria Hb | A1c capturado ANTES de Hb (e vira analito extra) |
| `HCM`, `CHCM`, `RDW`, `VPM`, bastonetes, linfócitos atípicos | `IGNORE_PATTERNS` mascarados antes de tudo |
| `CA 125 12 U/mL` viraria Ca=125 | ignorar `ca 125/19-9/15-3/72-4` |
| `Colesterol HDL` casaria com CT genérico | família lipídica específica antes; máscara bloqueia o gap |
| `Saturação de transferrina` × `Transferrina` | SatTransf antes de Transf |
| `Capacidade total de ligação do ferro` contém "ferro" | TIBC antes de Ferro |
| `25-Hidroxivitamina D 22,4` pegaria 25 | padrão pula o "25" do nome; parênteses no gap são descartados |
| `Desidrogenase láctica` × lactato | LDH antes de Lact |
| `mg/dL` dispararia Mg | `near` exige dígito após o código |
| `Liberado na 12/08/2026` viraria Na=2026 | guarda de data em `findValue` |
| pH da urina | skip de seção de urina |
| `Ureia 52 mg/dL VR: 10 a 50` pegaria 10 | corte em `REF_CUT` antes do matching |
| `TIROXINA LIVRE (T4L),SANGUE` viraria T4L=4 | rejeitar número precedido de letra |
| `Contagem absoluta de reticulócitos: 9,14 mil` viraria Ret 9,14% | IGNORE + Ret pega o `RESULTADO: 2,3 %` |
| `Volume corpuscular médio (VCM R)` contaminaria VCM | IGNORE "vcm r" |
| Faixa de referência quebrada (`1 a 14 anos Homens: 186 388 mg/dL`) engolida como valor | `REF_WRAP` rejeita; linha-de-valor exige unidade após o número (`UNIT_AFTER`) |
| Diferencial no singular (`Linfócito: 1,32 39,4 %`) | padrões com plural opcional; % preferido |
| `Observação Plaquetas:` viraria pendência falsa | `ADMIN_SKIP` inclui "observac" |

### Layout hospitalar ICr/SIGH (validado com laudos reais)

1. **Nome sem rótulo**: `0014163072H NOME EM CAPS` na 2ª linha → fallback
   `ID_NAME_LINE` (registro com dígitos + nome todo em CAPS, ≥2 palavras,
   blacklist de termos institucionais).
2. **Nome do exame e valor em linhas separadas**: `CREATININA (SORO)` →
   `RESULTADO: 0,16 mg/dL` ou `82 mg/dL` (às vezes com `Método:` e até
   quebra de página no meio). Mecanismo: cabeçalho sem dígitos que casa com
   EXATAMENTE UM analito vira pendência {analito, ttl≈6}; linhas
   administrativas NÃO limpam a pendência; a linha-de-valor deve começar com
   número/RESULTADO (qualificador `<`/`>` aceito e preservado), ter unidade
   imediatamente após o número (mg, mEq, μ, K/, %, ...) ou ser só-número,
   nunca casar `REF_WRAP`, e ter ≤6 dígitos inteiros (anti-protocolo).
   Captura normal do MESMO analito cancela a pendência.
3. **Datas por bloco**: um PDF concatena exames de VÁRIAS datas. `Coletado
   em` (com hora) tem prioridade; `Liberado/Recebido em` (só data) é
   fallback POR BLOCO — cada exame herda o marcador mais recente no texto.
   Aviso obrigatório quando liberação substituiu coleta.
4. **Plaquetas em K/μL** (= mil): `RESULTADO: 93 K/μL` → `Plaq 93mil`.
5. **Hora da liberação preservada**: exames seriados do mesmo dia (comuns em
   internados) não colapsam; a ROTINA funde blocos vizinhos (≤45 min) sem
   analito em comum (painel liberado em lotes) e mantém separados os que
   repetem analito (pré/pós).
6. **Pré/Pós-diálise (MENSALÃO)**: 2+ dosagens de Ur/Cr no mesmo dia em
   horários diferentes → primeira linha normal e última com prefixo "Pós":
   `07/08/26: Ur 17,6 Cr 0,16` / `07/08/26: Pós Ur 19,8 Cr 0,18`.
7. **Exames fora do dicionário — SEMPRE incluídos, no formato mais
   compacto possível**: bloco `DEMAIS EXAMES:` ao final dos dois modelos,
   uma linha por dia, exames separados por ` // `:
   `10/08/26: Anti HIV 1/2 NR // HBsAg NR // Toxo IgG <0,2 IgM 0,08 //
   Anti-Cardiolipina IgG 37,1 IgM 8,0 // FAN nuclear pontilhado fino 1/80`
   - Abreviações: Não Reagente→NR, Reagente→R, Não Detectado→ND,
     Negativo→Neg, Positivo→Pos; unidades derrubadas (39 GPL→39); títulos
     (1/80) mantidos; "Reagente, padrão X"→só o padrão; "Inferior/Superior
     a N"→`<N`/`>N`.
   - IgG/IgM do MESMO exame agrupados numa entrada; siglas preferidas
     (parênteses "(EBV)" vence; CMV/EBV/Toxo/HSV mapeados; em
     "Hepatite B - HBeAg" a sigla do 2º trecho vence).
   - Captura: título em CAPS (ICr) OU caixa mista com termo de
     sorologia/autoanticorpo iniciando em maiúscula (DASA-like); valor
     inline na própria linha, em "Resultado:" posterior, ou qualitativo.
   - Defesas: faixa em linha própria ("0,50 a 1,00") NUNCA é valor
     (`RANGE_LINE` — este layout imprime a referência ANTES do resultado);
     blocos "Histórico"/"Gráfico de Histórico" pulados (resultados
     antigos); rodapé "Locais de execução" ignorado (lista nomes de
     exames); hash de assinatura (64 hex) pulado; frases de nota (>6
     palavras ou com ":") rejeitadas como valor; "(Vide Intervalo...)"
     tolera parêntese truncado; "N IgA/IgG/IgM" não é valor+unidade
     (nome quebrado); itens IGNORE (CHCM/RDW/VPM) nunca viram genérico.
   - Leucócitos em layout %|absoluto ("Leucócitos 100 9.240"): o 100 da
     coluna % é pulado (`twoCol`).
8. **Urina (grupo U1)**: seções de urina têm modo próprio — itens saem como
   `U1 pH 7,0 Dens 1012 Leuco >1 MILHÃO Erit 265000 Bacterias NUMEROSAS
   Nitrito POSITIVO ...` (ROTINA: no bloco da coleta; MENSALÃO: linha
   própria do dia). Resultados vêm em CAPS e referências em caixa mista
   (discriminador); sedimento quantitativo prevalece sobre a tira reativa
   em Leuco/Erit; dismorfismo eritrocitário sai com o texto ("Ausência de
   hematúria / dismorfismo"). Relações proteína/creatinina e
   microalbumina/creatinina saem como **P/C** e **M/C** (extras normais),
   inclusive quando o título da relação está na própria linha que dispara a
   seção de urina. pH/Glic séricos permanecem protegidos.

## 7. UX (3 passos numa página)

1. **Laudos do paciente** — textarea (colar), upload PDF/imagem/txt
   (múltiplos), botão "Carregar exemplo" (laudo sintético fictício). Cada
   fonte vira um cartão: rótulo, tipo, chip com o nome detectado (ou "nome
   não encontrado"), nº de exames reconhecidos, remover. Nota de privacidade
   visível. PDF sem camada de texto (<60 chars extraídos) ⇒ oferecer envio à
   API com `window.confirm` explicando que os dados saem da máquina; imagens
   idem.
2. **Confirmação do paciente** — nome único detectado ⇒ banner com botão
   "Confirmar paciente"; nomes divergentes ⇒ banner vermelho BLOQUEANDO com
   os nomes em conflito; nenhum nome ⇒ campo para digitar. Adicionar/remover
   fonte invalida a confirmação. Avisos (sem data, sem nome) em banner
   separado — nunca dentro do texto copiável.
3. **Transcrição** — toggle ROTINA/MENSALÃO, `<pre>` monoespaçado escuro,
   botão Copiar (clipboard) com feedback "copiado ✓". Saída só renderiza com
   paciente confirmado e sem conflito.

## 8. Casos de aceitação (saídas exatas, já validadas)

Entrada A (coleta 10/08/2026 07:15 — hemograma com diferencial em % e
absoluto, bioquímica; 16:40 — gasometria venosa) + Entrada B (05/08/2026
07:30 — tireoide, ferro, lipídios, Ret, FA, VitD, HbA1c, seção de urina com
pH 6,0, e Hb 10,8 após cabeçalho HEMOGRAMA) ⇒

```
MODELO ROTINA 05/08/26 (07:30): Hb 10,8 FA 210 Ret 2,8% TSH 3,10 T4L 0,98 PTH 185 Ferro 45 Transf 190 SatTransf 19% Ferritina 310 TIBC 240 CT 152 HDL 38 LDL 88 VLDL 26 Não-HDL 114 Trig 130 VitD 22,4 HbA1c 5,4%

MODELO ROTINA 10/08/26 (07:15): Ur 52 Cr 1,4 Glic 92 Na 138 K 4,7 Mg 2,1 Cl 104 Ca 9,1 P 4,2 CaI 4,9 Hb 11,2 Ht 34,5% Plaq 245mil Leuco 6,84mil (N 62,0% L 26,0% M 8,0% E 3,0% B 1,0%) PT 6,8 Alb 3,9 TGO 28 TGP 31 PCR 0,4 VCM 88,0

MODELO ROTINA 10/08/26 (16:40): pH 7,32 pCO2 44,0 pO2 38,0 HCO3 21,8 BE -3,1 SatO2 68,0% Lact 1,4
```

```
MODELO MENSALÃO 10/08/26 (16:40):
05/08/26: TSH 3,10 T4L 0,98 PTH 185
05/08/26: Ferro 45 Transf 190 SatTransf 19% Ferritina 310 TIBC 240
05/08/26: CT 152 HDL 38 LDL 88 VLDL 26 Não-HDL 114 Trig 130
10/08/26: Ur 52 Cr 1,4
10/08/26: PCR 0,4
10/08/26: TGO 28 TGP 31
10/08/26: PT 6,8 Alb 3,9
10/08/26: pH 7,32 pCO2 44,0 pO2 38,0 HCO3 21,8 BE -3,1 SatO2 68,0% Lact 1,4 Glic 92
10/08/26: Na 138 K 4,7 Mg 2,1 Cl 104
10/08/26: Ca 9,1 P 4,2 CaI 4,9
05/08/26: Hb 10,8
10/08/26: Hb 11,2 Ht 34,5% VCM 88,0
10/08/26: Leuco 6840 (N 62,0% L 26,0% M 8,0% E 3,0% B 1,0%) Plaq 245mil
05/08/26: Ret 2,8%
05/08/26: FA 210 VitD 22,4 HbA1c 5,4%
```

Critérios extras: pH sérico capturado mesmo com líderes de pontos; pH 6,0 da
urina AUSENTE; VitD = 22,4 (não 25); HbA1c não contamina Hb; laudo de outro
paciente bloqueia a saída até ser removido; sem confirmação não há saída.

## 9. Roadmap / pendências

- **GitHub**: usuária quer publicar em repositório existente dela. Máquina
  sem `gh`/Homebrew/SSH/credenciais. Falta: URL do repo + método de
  autenticação (download do `gh` com device-flow, ou PAT com push manual) +
  decidir mesclar × substituir conteúdo existente.
- **Backend futuro** (espaço reservado): novas rotas em `app/api/`,
  reutilizando `lib/` (isomórfico); banco local (SQLite via Prisma/Drizzle)
  sem tocar no parser.
- Possível: distinguir ureia pré/pós-diálise no mesmo horário.
