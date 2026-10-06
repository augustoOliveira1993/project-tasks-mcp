/** Identidade visual do Project Tasks para clientes MCP (ícone exibido ao lado do nome do servidor). */
const LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '<defs><linearGradient id="g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7a86f3"/><stop offset="1" stop-color="#4350c8"/></linearGradient></defs>',
  '<rect width="64" height="64" rx="15" fill="url(#g)"/>',
  '<circle cx="19" cy="20" r="7.5" fill="#fff"/>',
  '<path d="m15.4 20.2 2.6 2.6 4.8-5.4" fill="none" stroke="#4a58d0" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  '<rect x="31" y="16.5" width="22" height="7" rx="3.5" fill="#fff"/>',
  '<circle cx="19" cy="34" r="6.2" fill="none" stroke="#fff" stroke-width="2.6" opacity=".85"/>',
  '<rect x="31" y="30.5" width="17" height="7" rx="3.5" fill="#fff" opacity=".85"/>',
  '<circle cx="19" cy="48" r="6.2" fill="none" stroke="#fff" stroke-width="2.6" opacity=".55"/>',
  '<rect x="31" y="44.5" width="12" height="7" rx="3.5" fill="#fff" opacity=".55"/>',
  '</svg>'
].join('');

export const MCP_SERVER_ICONS = [
  { src: `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`, mimeType: 'image/svg+xml', sizes: ['any'] }
];
