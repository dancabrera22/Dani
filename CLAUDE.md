# Transcritor de Exames — contexto para o Claude Code

Plataforma Next.js **local** que transcreve laudos laboratoriais (pt-BR) nos
formatos MODELO ROTINA e MODELO MENSALÃO. A especificação completa do produto
(regras, formatos, decisões) está em `ESPECIFICACAO.md` — leia-a antes de
alterar o parser ou os formatadores.

## Comandos

```bash
npm run dev     # http://localhost:3000
npm run build   # valida compilação
node <script>   # lib/ é ESM puro — testável direto no Node, sem Next
```

Teste rápido do parser (sem browser): crie um `.mjs` que importe
`lib/parse.js` + `lib/format.js`, passe um laudo sintético por `parseReport()`
e imprima `formatRotina()`/`formatMensalao()`. Nunca use laudos reais de
pacientes em testes ou fixtures.

## Arquitetura

```
lib/         módulos PUROS (sem browser, sem Next) — reutilizáveis por backend futuro
  analytes.js  dicionário de ~70 analitos com sinônimos + ordens dos modelos
  parse.js     parser determinístico (nome do paciente, coletas, valores)
  format.js    formatadores ROTINA / MENSALÃO
app/
  page.js      UI (client): fontes → confirmação de paciente → saída
  api/transcribe/route.js  OCR de imagens/PDFs escaneados via Claude API
                           (modelo claude-opus-5; chave em .env.local)
```

Fluxo: entrada (texto colado / PDF via pdf.js local / imagem via API) →
`parseReport()` por fonte → `mergeResults()` → trava de confirmação do
paciente → `formatRotina()` ou `formatMensalao()`.

## Invariantes que NÃO podem quebrar

1. **Privacidade**: texto e PDF com camada de texto nunca saem da máquina; a
   API só é chamada para imagem/PDF escaneado e SEMPRE após confirmação
   explícita do usuário na UI.
2. **Trava de paciente**: nomes distintos entre fontes bloqueiam a saída;
   nada é transcrito sem confirmação explícita do nome.
3. **Agrupamento por coleta**: ROTINA = um bloco por data+hora; MENSALÃO =
   linhas por categoria agrupadas por dia, na ordem de `MENSALAO_LINES`.
4. **Omissão**: exame ausente é omitido (sem marcadores); valor não
   reconhecido é descartado, nunca inventado.
5. **Saída limpa**: apenas o texto do modelo — sem saudações nem comentários.

## Armadilhas do parser (não regredir)

- A ORDEM de `ANALYTES` importa: específicos antes de genéricos, com máscara
  (`\x00`) após cada match. Ex.: SatTransf antes de Transf; TIBC antes de
  Ferro; VLDL antes de LDL; CaI antes de Ca.
- `IGNORE_PATTERNS` mascara falsos amigos ANTES de tudo: HbA1c×Hb, HCM/CHCM,
  CA-125×Ca, bastonetes, RDW, VPM, "contagem absoluta de reticulócitos",
  IRF, "VCM R" (reticulocitário), "hemoglobina do paciente".
- Códigos curtos (`near: true`) aceitam líderes de pontos (`pH .... 7,32`)
  mas nunca letras no caminho até o valor (evita "na coleta" → Na).
- `findValue` rejeita números colados a `/` ou `:` (datas/horas), números
  precedidos de letra (o "4" de "(T4L)") e corta a linha em marcadores de
  valor de referência (`REF_CUT`).
- Seções de urina (`URINE_SECTION`) são puladas até um cabeçalho de sangue
  (`BLOOD_SECTION`) — protege o pH sérico.
- Números pt-BR: `4.960` = milhar; `7,35`, `7.35` e `13.0` = decimal. Saída
  sempre com vírgula. Qualificadores `<`/`>` preservados (`Ca >13,0`).
- Conversões: Plaq sempre em `mil` (bruto>10000 ÷1000; unidade K/μL já é
  mil); Leuco em `mil` na ROTINA e absoluto no MENSALÃO.

### Layout hospitalar ICr/SIGH (validado com laudos reais)

- Nome SEM rótulo: `0014163072H NOME EM CAPS` → fallback `ID_NAME_LINE`.
- Nome do exame numa linha, valor em OUTRA (`CREATININA (SORO)` →
  `RESULTADO: 0,16` ou `82 mg/dL`, às vezes após quebra de página) →
  mecanismo `pending` {analito, ttl}. Linhas administrativas (`ADMIN_SKIP`)
  NÃO limpam a pendência (o valor pode vir após o rodapé); faixas de
  referência quebradas (`REF_WRAP`: anos/homens/mulheres...) são rejeitadas
  como linha-de-valor e não consomem TTL; linha-de-valor exige unidade logo
  após o número (`UNIT_AFTER`) ou linha só-número.
- Datas POR BLOCO: um PDF traz exames de VÁRIAS datas; `Coletado em`
  (prioridade, com hora) e `Liberado/Recebido em` (fallback, só data)
  atualizam o marcador corrente — cada exame herda o mais recente
  (`currentDTNow()`); aviso quando a data de liberação foi usada.
- Diferencial no singular (`Linfócito:`, `Segmentado neutrófilo:`) com
  absoluto + % na mesma linha → analitos `percent: true` preferem o %.

## Limitação conhecida

Ureia pré/pós-diálise **no mesmo horário**: dedup mantém só o primeiro valor
(horários distintos funcionam). Se for corrigir, o dedup está em
`parseReport`/`mergeResults` (chave `id|sortKey`).

## Publicação

- **GitHub**: https://github.com/dancabrera22/Dani (branch `main`).
  `gh` instalado em `~/bin/gh`, autenticado como dancabrera22; push via
  `git push` funciona (credential helper configurado).
- **Vercel**: https://transcritor-exames.vercel.app (projeto
  `transcritor-exames`, conta dancabrera22/iris-dicom). Deploy manual:
  `npx vercel deploy --prod --yes`. **Sem** `ANTHROPIC_API_KEY` no ambiente
  Vercel, de propósito: o site público opera só no modo offline (texto/PDF
  com camada de texto); OCR de imagem fica restrito ao uso local. Não
  configurar a chave lá sem decisão explícita da usuária.
