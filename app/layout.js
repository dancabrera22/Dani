import './globals.css';

export const metadata = {
  title: 'Transcritor de Exames',
  description:
    'Transcrição local de laudos laboratoriais: ROTINA, MENSALÃO, PRISMA, TUBULOPATIAS e IMAGEM',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
