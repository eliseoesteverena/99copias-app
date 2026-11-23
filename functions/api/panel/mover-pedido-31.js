// TEMPORAL — borrar este archivo después de usarlo.
// Copia los 94 archivos del pedido 31 de staging/ a trabajos/31/ (dentro de R2, sin descargar nada).
// Ruta:  functions/api/panel/mover-pedido-31.js   →   GET /api/panel/mover-pedido-31
// Uso desde el navegador (de a tandas, para no pasar el límite de operaciones de la Function):
//   https://app.99copias.com.ar/api/panel/mover-pedido-31?s=TU_PANEL_TO_WIZARD_SECRET&desde=0
// Cada respuesta trae un link "Siguiente tanda". Al final, abrir con &verificar=1.
// No borra nada de staging/.

const TANDA = 8;
const MANIFEST = [
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600758-931_arca_oct26.pdf", "trabajos/31/1-931_arca_oct26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600923-RECIBO_SUELDO_OCT26_1331138.pdf", "trabajos/31/2-RECIBO_SUELDO_OCT26_1331138.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600607-sindicatos_oct26_93803.42.pdf", "trabajos/31/3-sindicatos_oct26_93803.42.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600643-TRANSF_ARCA_VEP_OCT26_934393.98.pdf", "trabajos/31/4-TRANSF_ARCA_VEP_OCT26_934393.98.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600491-transf_sueldo_oct26_1331138.pdf", "trabajos/31/5-transf_sueldo_oct26_1331138.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600605-acuse_arca_oct26.pdf", "trabajos/31/6-acuse_arca_oct26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600492-libro_de_sueldo_oct26.pdf", "trabajos/31/7-libro_de_sueldo_oct26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600495-factura_seguridad_oct26_fc001_6440659.20.pdf", "trabajos/31/8-factura_seguridad_oct26_fc001_6440659.20.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600500-FACTURA_JARDIN_OCT26_FC_372_200000.pdf", "trabajos/31/9-FACTURA_JARDIN_OCT26_FC_372_200000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600499-FACTURA_HONORARIOS_OCT26_680000.pdf", "trabajos/31/10-FACTURA_HONORARIOS_OCT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600510-factura_herrero_reynoso_nov26_fc_185_120000.pdf", "trabajos/31/11-factura_herrero_reynoso_nov26_fc_185_120000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600513-factura_herrero_oct26_fc_185_120000.pdf", "trabajos/31/12-factura_herrero_oct26_fc_185_120000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600511-FACTURA_FUMIGACION_OCT26_FC_2451_102000.pdf", "trabajos/31/13-FACTURA_FUMIGACION_OCT26_FC_2451_102000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448601189-factura_edesur_oct26_1558133.04.pdf", "trabajos/31/14-factura_edesur_oct26_1558133.04.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600621-FACTURA_EDESUR_OCT26_1.464.976_76.pdf", "trabajos/31/15-FACTURA_EDESUR_OCT26_1.464.976_76.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600522-TRANSF_CERRAJERO_LLAVES_OCT26_400000.pdf", "trabajos/31/16-TRANSF_CERRAJERO_LLAVES_OCT26_400000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600636-factura_gestionar_oct26_fc_62473_65900.pdf", "trabajos/31/17-factura_gestionar_oct26_fc_62473_65900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600695-factura_limpos_limpieza_oct26_fc_124_454672.jpeg", "trabajos/31/18-factura_limpos_limpieza_oct26_fc_124_454672.jpeg"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600644-FACTURA_SIOS_OCT26_FC150357_420788.pdf", "trabajos/31/19-FACTURA_SIOS_OCT26_FC150357_420788.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600545-transf_ascensor_adelanto_reparacion_oct26_3000000.pdf", "trabajos/31/20-transf_ascensor_adelanto_reparacion_oct26_3000000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600541-TRANSF_HONORARIOS_OCT26_680000.pdf", "trabajos/31/21-TRANSF_HONORARIOS_OCT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600542-TRANSF_JARDIN_OCT26_FC_372_200000.pdf", "trabajos/31/22-TRANSF_JARDIN_OCT26_FC_372_200000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600573-transf_limpieza_limpos_oct26_fc_124_454672.pdf", "trabajos/31/23-transf_limpieza_limpos_oct26_fc_124_454672.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600575-transf_seguridad_oct26_fc_3849_7793197.20.pdf", "trabajos/31/24-transf_seguridad_oct26_fc_3849_7793197.20.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600590-transf_sios_oct26_fc_150357_420788.pdf", "trabajos/31/25-transf_sios_oct26_fc_150357_420788.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600563-FACTURA_ASCENSOR_OCT26_FC_59009_435900.pdf", "trabajos/31/26-FACTURA_ASCENSOR_OCT26_FC_59009_435900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600890-FACTURA_FUEGO_OCT26_FC172327_361132.pdf", "trabajos/31/27-FACTURA_FUEGO_OCT26_FC172327_361132.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600539-FACTURA_SEGURIDAD_OCT26_FC3849_7793197.20.PDF", "trabajos/31/28-FACTURA_SEGURIDAD_OCT26_FC3849_7793197.20.PDF"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600583-TRANSF_ASCENSOR_OCT26_FC_59009_435900.pdf", "trabajos/31/29-TRANSF_ASCENSOR_OCT26_FC_59009_435900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600584-transf_cerrajero_llaves_oct26_a_cuenta_800000.pdf", "trabajos/31/30-transf_cerrajero_llaves_oct26_a_cuenta_800000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600666-transf_edesur_mercado_oct26_1558133.04.jpeg", "trabajos/31/31-transf_edesur_mercado_oct26_1558133.04.jpeg"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600588-transf_edesur_mio_oct26_1600000.pdf", "trabajos/31/32-transf_edesur_mio_oct26_1600000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600546-transf_fuego_oct26_fc_172327_361132.pdf", "trabajos/31/33-transf_fuego_oct26_fc_172327_361132.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600593-TRANSF_FUMIGACION_OCT26_FC_2451_102000.pdf", "trabajos/31/34-TRANSF_FUMIGACION_OCT26_FC_2451_102000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600552-TRANSF_HERRERO_OCT26_CAJA_REPARACION_120000.pdf", "trabajos/31/35-TRANSF_HERRERO_OCT26_CAJA_REPARACION_120000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600722-TRANSF_METROGAS_OCT26_28523.78.pdf", "trabajos/31/36-TRANSF_METROGAS_OCT26_28523.78.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600599-transf_seguridad_oct26_fc_001_6440659.20.pdf", "trabajos/31/37-transf_seguridad_oct26_fc_001_6440659.20.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600584-transf_sueldo_adelanto_oct26_300000.pdf", "trabajos/31/38-transf_sueldo_adelanto_oct26_300000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600727-RESUMEN_OCTUBRE_2026.pdf", "trabajos/31/39-RESUMEN_OCTUBRE_2026.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617485-acuse_arca_septiembre26.pdf", "trabajos/31/40-acuse_arca_septiembre26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618051-arca_931_septiembre26.pdf", "trabajos/31/41-arca_931_septiembre26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617493-libro_de_sueldo_septiembre26.pdf", "trabajos/31/42-libro_de_sueldo_septiembre26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618153-RECIBO_SUELDO_SEPTIEMBRE26_1543007.pdf", "trabajos/31/43-RECIBO_SUELDO_SEPTIEMBRE26_1543007.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617948-transf_arca_vep_sept26_883840.56.pdf", "trabajos/31/44-transf_arca_vep_sept26_883840.56.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617714-transf_sueldo_sept26_se_desc_adelanto_x_200000.pdf", "trabajos/31/45-transf_sueldo_sept26_se_desc_adelanto_x_200000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617960-RESUMEN_SEPTIEMBRE_20226_1_.pdf", "trabajos/31/46-RESUMEN_SEPTIEMBRE_20226_1_.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617506-FACTURA_JARDIN_SEPT26_FC369_180000.pdf", "trabajos/31/47-FACTURA_JARDIN_SEPT26_FC369_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617484-FACTURA_JARDIN_AGOSTO26_FC366_180000.pdf", "trabajos/31/48-FACTURA_JARDIN_AGOSTO26_FC366_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617814-FACTURA_HONORARIOS_SEPT26_680000.pdf", "trabajos/31/49-FACTURA_HONORARIOS_SEPT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617480-factura_fumigacion_sep_26_fac_2451_102.000_directorio.pdf", "trabajos/31/50-factura_fumigacion_sep_26_fac_2451_102.000_directorio.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617818-factura_edesur_sept26.pdf", "trabajos/31/51-factura_edesur_sept26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617505-FACTURA_CERRAJERO_SEPT26_FC107_900000.pdf", "trabajos/31/52-FACTURA_CERRAJERO_SEPT26_FC107_900000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617514-factura_abogada_juicio_toledo_sept26_fc747_2da_instancia_2459070.90.pdf", "trabajos/31/53-factura_abogada_juicio_toledo_sept26_fc747_2da_instancia_2459070.90.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617496-factura_abogada_juicio_toledo_sept26_fc746_1ra_instancia_4413717.pdf", "trabajos/31/54-factura_abogada_juicio_toledo_sept26_fc746_1ra_instancia_4413717.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617996-FACTURA_DESTAPACION_SEPT26_FC9161_180000.pdf", "trabajos/31/55-FACTURA_DESTAPACION_SEPT26_FC9161_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618069-FACTURA_FUEGO_SEPT26_CTA_8_DE_12_336137.71.pdf", "trabajos/31/56-FACTURA_FUEGO_SEPT26_CTA_8_DE_12_336137.71.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618055-FACTURA_FUEGO_SEPT26_FC168784_357061.39.pdf", "trabajos/31/57-FACTURA_FUEGO_SEPT26_FC168784_357061.39.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617731-transf_cerrajero_sept26_cerradura_a_cuenta_900000.pdf", "trabajos/31/58-transf_cerrajero_sept26_cerradura_a_cuenta_900000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617728-transf_destapacion_sept26_fc9161_180000.pdf", "trabajos/31/59-transf_destapacion_sept26_fc9161_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617715-transf_fumigacion_sept26_fc2423_99000.pdf", "trabajos/31/60-transf_fumigacion_sept26_fc2423_99000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617726-TRANSF_JARDIN_SEPT26_FC366_180000.pdf", "trabajos/31/61-TRANSF_JARDIN_SEPT26_FC366_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617729-transf_limpos_sept26_667246.84.pdf", "trabajos/31/62-transf_limpos_sept26_667246.84.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617943-transf_metrogas_sept26_16352.24.pdf", "trabajos/31/63-transf_metrogas_sept26_16352.24.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617716-transf_seguridad_sept26_fc3823_7856558.16.pdf", "trabajos/31/64-transf_seguridad_sept26_fc3823_7856558.16.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617986-FACTURA_DESTAPACION_SEPT26_FC9162_96000.pdf", "trabajos/31/65-FACTURA_DESTAPACION_SEPT26_FC9162_96000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618101-FACTURA_ELECTRICISTA_SEPT26_FC1372_100000.pdf", "trabajos/31/66-FACTURA_ELECTRICISTA_SEPT26_FC1372_100000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618053-factura_electricista_sept26_fc1382_89000.pdf", "trabajos/31/67-factura_electricista_sept26_fc1382_89000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617769-factura_gestionar_sept26_fc57284_65900.pdf", "trabajos/31/68-factura_gestionar_sept26_fc57284_65900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618088-FACTURA_HERRERO_SEPT26_FC_306_BISAGRAS_80000.pdf", "trabajos/31/69-FACTURA_HERRERO_SEPT26_FC_306_BISAGRAS_80000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617728-transf_control_remoto_porton_sept26_abonado_por_propietarios_jose_fc_1156_60500.pdf", "trabajos/31/70-transf_control_remoto_porton_sept26_abonado_por_propietarios_jose_fc_1156_60500.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617730-transf_electricista_sept26_fc_89000.pdf", "trabajos/31/71-transf_electricista_sept26_fc_89000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617706-TRANSF_ELECTRICISTA_SEPT26_FC1372_100000.pdf", "trabajos/31/72-TRANSF_ELECTRICISTA_SEPT26_FC1372_100000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617725-TRANSF_HONORARIOS_SEPT26_680000.pdf", "trabajos/31/73-TRANSF_HONORARIOS_SEPT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617748-TRANSF_PROPIETARIA_PEDALINO_DEVOLUCION_EXPENSAS_SEPT26_800000.pdf", "trabajos/31/74-TRANSF_PROPIETARIA_PEDALINO_DEVOLUCION_EXPENSAS_SEPT26_800000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617705-transf_sueldo_adelanto_sept26_300000.pdf", "trabajos/31/75-transf_sueldo_adelanto_sept26_300000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617639-FACTURA_ASCENSOR_SEPT26_FC58511_435900.PDF", "trabajos/31/76-FACTURA_ASCENSOR_SEPT26_FC58511_435900.PDF"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618097-FACTURA_ELECTRICISTA_MATERIALES_SEPT26_47000.pdf", "trabajos/31/77-FACTURA_ELECTRICISTA_MATERIALES_SEPT26_47000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618073-factura_electricista_materiales_sept26_69000.pdf", "trabajos/31/78-factura_electricista_materiales_sept26_69000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618087-factura_seguridad_sept26_fc50_6493021.92.pdf", "trabajos/31/79-factura_seguridad_sept26_fc50_6493021.92.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617740-transf_abogada_juicio_sept26_fc747_2459070.90.pdf", "trabajos/31/80-transf_abogada_juicio_sept26_fc747_2459070.90.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617744-transf_ascensor_sept26_fc58511_435900.pdf", "trabajos/31/81-transf_ascensor_sept26_fc58511_435900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617742-transf_destapacion_sept26_fc9162_96000.pdf", "trabajos/31/82-transf_destapacion_sept26_fc9162_96000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617738-transf_edesur_sept26_1567000_mio.pdf", "trabajos/31/83-transf_edesur_sept26_1567000_mio.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617741-transf_edesur_sept26_1567000.pdf", "trabajos/31/84-transf_edesur_sept26_1567000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617749-transf_electricista_materiales_sept26_47000.pdf", "trabajos/31/85-transf_electricista_materiales_sept26_47000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617746-transf_electricista_materiales_sept26_69000.pdf", "trabajos/31/86-transf_electricista_materiales_sept26_69000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617741-TRANSF_FUEGO_SEPT26_FC163179_336137.71.pdf", "trabajos/31/87-TRANSF_FUEGO_SEPT26_FC163179_336137.71.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617746-transf_herrero_sept26_visagras_80000.pdf", "trabajos/31/88-transf_herrero_sept26_visagras_80000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617750-TRANSF_JARDIN_SEPT26_FC_369_180000.pdf", "trabajos/31/89-TRANSF_JARDIN_SEPT26_FC_369_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617803-factura_limpos_sept26_fc111_667246.84.pdf", "trabajos/31/90-factura_limpos_sept26_fc111_667246.84.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617704-factura_seguridad_sept26_fc3823_7856558.16.PDF", "trabajos/31/91-factura_seguridad_sept26_fc3823_7856558.16.PDF"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617765-transf_abogada_juicio_sept26_fc746_4413717.pdf", "trabajos/31/92-transf_abogada_juicio_sept26_fc746_4413717.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617809-transf_cartadocumento_4g_sep26_24000.pdf", "trabajos/31/93-transf_cartadocumento_4g_sep26_24000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617710-transf_seguridad_sept26_fc50_6493021.92.pdf", "trabajos/31/94-transf_seguridad_sept26_fc50_6493021.92.pdf"]
];

function html(cuerpo, status = 200) {
  return new Response(`<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:15px system-ui;padding:16px;line-height:1.5">${cuerpo}</body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const secreto = url.searchParams.get('s');
  if (!env.PANEL_TO_WIZARD_SECRET || secreto !== env.PANEL_TO_WIZARD_SECRET) {
    return html('No autorizado.', 401);
  }
  const base = `${url.origin}${url.pathname}?s=${encodeURIComponent(secreto)}`;

  // Diagnóstico: qué ve realmente el binding BUCKET
  if (url.searchParams.get('listar') === '1') {
    const prefijo = 'staging/b1eabb53-e867-48bf-a434-7361aa8123eb/';
    const raiz = await env.BUCKET.list({ delimiter: '/', limit: 50 });
    const claves = [];
    let cursor;
    do {
      const r = await env.BUCKET.list({ prefix: prefijo, cursor, limit: 1000 });
      claves.push(...r.objects.map(o => o.key));
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    const set = new Set(claves);
    const sinMatch = MANIFEST.filter(([v]) => !set.has(v)).map(([v]) => v);
    return html(
      `<p><b>Carpetas en la raíz del bucket:</b><br>${(raiz.delimitedPrefixes || []).join('<br>') || '(ninguna)'}<br>Objetos sueltos en raíz: ${raiz.objects.length}</p>` +
      `<p><b>Objetos bajo la sesión:</b> ${claves.length} (el manifest espera ${MANIFEST.length})<br>` +
      `<b>Del manifest sin coincidencia exacta:</b> ${sinMatch.length}</p>` +
      `<p><b>Primeras keys reales (JSON, muestra caracteres ocultos):</b><br>${claves.slice(0, 5).map(k => JSON.stringify(k)).join('<br>') || '(ninguna)'}</p>` +
      `<p><b>Primera key esperada:</b><br>${JSON.stringify(MANIFEST[0][0])}</p>`);
  }

  // Verificación final: ¿existen los 94 destinos?
  if (url.searchParams.get('verificar') === '1') {
    const faltan = [];
    for (const [, nuevo] of MANIFEST) {
      const h = await env.BUCKET.head(nuevo);
      if (!h) faltan.push(nuevo);
    }
    return html(faltan.length === 0
      ? `✅ Los ${MANIFEST.length} archivos existen en trabajos/31/. Ya podés correr el SQL.`
      : `⚠️ Faltan ${faltan.length}:<br>${faltan.join('<br>')}`);
  }

  const desde = Math.max(0, parseInt(url.searchParams.get('desde') || '0', 10) || 0);
  const hasta = Math.min(MANIFEST.length, desde + TANDA);
  const log = [];
  for (let i = desde; i < hasta; i++) {
    const [viejo, nuevo] = MANIFEST[i];
    try {
      const obj = await env.BUCKET.get(viejo);
      if (!obj) { log.push(`❌ ${i + 1} no existe en staging: ${viejo}`); continue; }
      await env.BUCKET.put(nuevo, obj.body, { httpMetadata: obj.httpMetadata });
      log.push(`✅ ${i + 1} ${nuevo}`);
    } catch (e) {
      log.push(`❌ ${i + 1} ${nuevo} — ${e.message}`);
    }
  }

  const siguiente = hasta < MANIFEST.length
    ? `<p><a href="${base}&desde=${hasta}"><b>Siguiente tanda (${hasta + 1}–${Math.min(MANIFEST.length, hasta + TANDA)}) →</b></a></p>`
    : `<p><b>Terminó.</b> <a href="${base}&verificar=1">Verificar los ${MANIFEST.length}</a></p>`;
  return html(`<p>Tanda ${desde + 1}–${hasta} de ${MANIFEST.length}</p>${log.join('<br>')}${siguiente}`);
}
