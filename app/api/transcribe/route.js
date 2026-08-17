// Rota local que envia imagem/PDF escaneado para o Claude API e devolve o
// TEXTO BRUTO transcrito. A formatação nos modelos ROTINA/MENSALÃO é feita
// pelo parser local — a API é usada apenas como OCR fiel.
//
// Requer ANTHROPIC_API_KEY em .env.local. Sem a chave, a rota responde 503 e
// o app continua funcionando 100% offline para texto colado e PDF com texto.

import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

const MAX_BYTES = 30 * 1024 * 1024; // limite da API é 32MB por requisição

const SYSTEM = `Você é um transcritor de laudos laboratoriais.
Transcreva FIELMENTE todo o texto do documento enviado, em texto puro, preservando a estrutura em linhas.
Inclua obrigatoriamente, quando presentes: nome do paciente, data e horário de coleta de cada exame, e cada analito com seu valor numérico e unidade.
Não resuma, não interprete, não omita valores, não adicione comentários nem cabeçalhos seus.
Se houver mais de um horário de coleta no documento, mantenha cada bloco sob a linha de coleta correspondente.
Saída: apenas o texto transcrito.`;

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          'ANTHROPIC_API_KEY não configurada. Crie um arquivo .env.local com a chave para habilitar leitura de imagens/PDFs escaneados.',
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const { media_type: mediaType, data } = body || {};
  if (!ALLOWED.has(mediaType)) {
    return Response.json(
      { error: `Tipo de arquivo não suportado: ${mediaType}` },
      { status: 400 }
    );
  }
  if (typeof data !== 'string' || data.length === 0) {
    return Response.json({ error: 'Arquivo vazio.' }, { status: 400 });
  }
  if (data.length * 0.75 > MAX_BYTES) {
    return Response.json(
      { error: 'Arquivo muito grande (máx. ~30MB).' },
      { status: 413 }
    );
  }

  const block =
    mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

  const client = new Anthropic({ apiKey });

  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
      max_tokens: 16000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            block,
            { type: 'text', text: 'Transcreva este laudo laboratorial.' },
          ],
        },
      ],
    });

    if (msg.stop_reason === 'refusal') {
      return Response.json(
        { error: 'O modelo recusou a transcrição deste documento.' },
        { status: 502 }
      );
    }

    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) {
      return Response.json(
        { error: 'A transcrição voltou vazia.' },
        { status: 502 }
      );
    }

    return Response.json({ text, truncated: msg.stop_reason === 'max_tokens' });
  } catch (err) {
    const status = err?.status ?? 500;
    const detail =
      status === 401
        ? 'Chave de API inválida (verifique .env.local).'
        : status === 429
          ? 'Limite de requisições atingido. Tente novamente em instantes.'
          : err?.message || 'Erro ao chamar a API.';
    return Response.json({ error: detail }, { status: 502 });
  }
}
