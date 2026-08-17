# Transcritor de Exames

Plataforma local (Next.js) que transcreve laudos laboratoriais nos formatos
**MODELO ROTINA** e **MODELO MENSALÃO**, com validação obrigatória do nome do
paciente e agrupamento estrito por data/horário de coleta.

## Como rodar

```bash
cd transcritor-exames
npm install
npm run dev
```

Abra <http://localhost:3000>.

## O que funciona offline (sem chave, sem internet)

- **Texto colado** — cole o laudo e clique em *Adicionar texto*.
- **PDF com camada de texto** — extraído localmente com pdf.js; nada sai do computador.
- Todo o parsing, agrupamento por coleta e formatação são 100% locais.

## O que precisa da API da Anthropic (opcional)

- **Imagens** (foto do laudo) e **PDFs escaneados** (sem camada de texto).
- Configure: `cp .env.local.example .env.local` e preencha `ANTHROPIC_API_KEY`.
- O app **sempre pede confirmação** antes de enviar qualquer arquivo para fora.
- A API é usada apenas como OCR fiel; a formatação final é feita pelo parser
  local (mesmas regras para todas as entradas).

## Regras implementadas

1. **Validação do paciente** — o nome é extraído de cada laudo e exibido; a
   transcrição só é liberada após confirmação explícita. Laudos com nomes
   diferentes **bloqueiam** a saída até serem removidos.
2. **Agrupamento por coleta** — cada bloco/linha corresponde a uma data+hora de
   coleta; horários diferentes no mesmo dia geram linhas separadas (ROTINA).
   No MENSALÃO o agrupamento é por dia, como no modelo.
3. **Saída limpa** — apenas o texto no modelo; sem saudações, resumos ou
   comentários. Exames ausentes são omitidos.

## Limitações conhecidas (revise sempre a saída)

- Ureia **pré/pós-diálise no mesmo horário**: só o primeiro valor é mantido
  (horários distintos funcionam normalmente).
- Seções de urina (EAS etc.) são ignoradas por heurística de cabeçalho; laudos
  com layout incomum podem exigir revisão.
- O parser é determinístico e conservador: valor não reconhecido = omitido,
  nunca inventado. **A conferência clínica final é sua.**

## Estrutura (pensada para backend futuro)

```
lib/            módulos puros, sem dependência de browser/Next
  analytes.js   dicionário de sinônimos + ordem dos modelos
  parse.js      parser (nome, coletas, valores)
  format.js     formatadores ROTINA / MENSALÃO
app/
  page.js       interface (client)
  api/
    transcribe/ rota server-side (OCR via Claude) — já é um backend embrionário
```

Para adicionar backend depois (histórico de pacientes, banco de dados, login):

- crie novas rotas em `app/api/...` (rodam em Node, já fora do browser);
- reutilize `lib/` diretamente no servidor — os módulos são isomórficos;
- um banco local (SQLite via Prisma/Drizzle) pode ser plugado sem tocar no parser.
