import './globals.css';

export const metadata = {
  title: 'Transcritor de Exames',
  description:
    'Transcrição local de laudos laboratoriais nos modelos ROTINA e MENSALÃO',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
