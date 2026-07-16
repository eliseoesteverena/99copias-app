// Sanitiza un nombre de archivo para usarlo como parte de una key de R2:
// solo letras/números/guiones/puntos, sin espacios ni separadores de ruta,
// con un tope de longitud razonable.
export function sanitizarNombreArchivo(nombre) {
  const base = (nombre || 'archivo').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // saca acentos
  const limpio = base
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return limpio || 'archivo';
}

export const TAMANO_MAXIMO_BYTES = 50 * 1024 * 1024; // 50 MB
export const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
