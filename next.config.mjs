/** @type {import('next').NextConfig} */
const nextConfig = {
  // App 100% local — sem telemetria de build desnecessária
  reactStrictMode: true,
  env: {
    // Uma fonte de verdade só: se a chave da API existe no ambiente de
    // build, o OCR de imagem aparece; se não existe, a opção nem é
    // desenhada. Na Vercel a chave não está configurada de propósito, então
    // o site público sai SEM nenhum caminho de envio — não é um botão que
    // falha, é um botão que não existe.
    NEXT_PUBLIC_OCR: process.env.ANTHROPIC_API_KEY ? '1' : '',
  },
};

export default nextConfig;
