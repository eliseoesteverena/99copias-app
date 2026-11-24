// TEMPORAL — borrar este archivo después de usarlo.
// Reconcilia el pedido 31: algunos archivos pueden estar en staging/, otros ya en trabajos/31/.
// Ruta:  functions/api/panel/mover-pedido-31.js   →   GET /api/panel/mover-pedido-31?s=SECRETO&...
//   estado=1      SOLO LECTURA: dónde está cada uno de los 94 (staging / trabajos/31 / en ningún lado)
//   desde=0       copia de staging/ a trabajos/31/ los que todavía estén solo en staging (de a 8)
//   actualizar=1  arregla las r2_key del pedido 31 en la D1 (solo si los 94 están resueltos)
// No borra nada.

const PEDIDO = 31;
const SESION = 'staging/b1eabb53-e867-48bf-a434-7361aa8123eb/';
const TANDA = 8;
// [key en staging según la base, nombre sin el timestamp]
const MANIFEST = [
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600758-931_arca_oct26.pdf", "931_arca_oct26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600923-RECIBO_SUELDO_OCT26_1331138.pdf", "RECIBO_SUELDO_OCT26_1331138.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600607-sindicatos_oct26_93803.42.pdf", "sindicatos_oct26_93803.42.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600643-TRANSF_ARCA_VEP_OCT26_934393.98.pdf", "TRANSF_ARCA_VEP_OCT26_934393.98.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600491-transf_sueldo_oct26_1331138.pdf", "transf_sueldo_oct26_1331138.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600605-acuse_arca_oct26.pdf", "acuse_arca_oct26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600492-libro_de_sueldo_oct26.pdf", "libro_de_sueldo_oct26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600495-factura_seguridad_oct26_fc001_6440659.20.pdf", "factura_seguridad_oct26_fc001_6440659.20.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600500-FACTURA_JARDIN_OCT26_FC_372_200000.pdf", "FACTURA_JARDIN_OCT26_FC_372_200000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600499-FACTURA_HONORARIOS_OCT26_680000.pdf", "FACTURA_HONORARIOS_OCT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600510-factura_herrero_reynoso_nov26_fc_185_120000.pdf", "factura_herrero_reynoso_nov26_fc_185_120000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600513-factura_herrero_oct26_fc_185_120000.pdf", "factura_herrero_oct26_fc_185_120000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600511-FACTURA_FUMIGACION_OCT26_FC_2451_102000.pdf", "FACTURA_FUMIGACION_OCT26_FC_2451_102000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448601189-factura_edesur_oct26_1558133.04.pdf", "factura_edesur_oct26_1558133.04.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600621-FACTURA_EDESUR_OCT26_1.464.976_76.pdf", "FACTURA_EDESUR_OCT26_1.464.976_76.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600522-TRANSF_CERRAJERO_LLAVES_OCT26_400000.pdf", "TRANSF_CERRAJERO_LLAVES_OCT26_400000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600636-factura_gestionar_oct26_fc_62473_65900.pdf", "factura_gestionar_oct26_fc_62473_65900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600695-factura_limpos_limpieza_oct26_fc_124_454672.jpeg", "factura_limpos_limpieza_oct26_fc_124_454672.jpeg"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600644-FACTURA_SIOS_OCT26_FC150357_420788.pdf", "FACTURA_SIOS_OCT26_FC150357_420788.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600545-transf_ascensor_adelanto_reparacion_oct26_3000000.pdf", "transf_ascensor_adelanto_reparacion_oct26_3000000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600541-TRANSF_HONORARIOS_OCT26_680000.pdf", "TRANSF_HONORARIOS_OCT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600542-TRANSF_JARDIN_OCT26_FC_372_200000.pdf", "TRANSF_JARDIN_OCT26_FC_372_200000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600573-transf_limpieza_limpos_oct26_fc_124_454672.pdf", "transf_limpieza_limpos_oct26_fc_124_454672.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600575-transf_seguridad_oct26_fc_3849_7793197.20.pdf", "transf_seguridad_oct26_fc_3849_7793197.20.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600590-transf_sios_oct26_fc_150357_420788.pdf", "transf_sios_oct26_fc_150357_420788.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600563-FACTURA_ASCENSOR_OCT26_FC_59009_435900.pdf", "FACTURA_ASCENSOR_OCT26_FC_59009_435900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600890-FACTURA_FUEGO_OCT26_FC172327_361132.pdf", "FACTURA_FUEGO_OCT26_FC172327_361132.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600539-FACTURA_SEGURIDAD_OCT26_FC3849_7793197.20.PDF", "FACTURA_SEGURIDAD_OCT26_FC3849_7793197.20.PDF"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600583-TRANSF_ASCENSOR_OCT26_FC_59009_435900.pdf", "TRANSF_ASCENSOR_OCT26_FC_59009_435900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600584-transf_cerrajero_llaves_oct26_a_cuenta_800000.pdf", "transf_cerrajero_llaves_oct26_a_cuenta_800000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600666-transf_edesur_mercado_oct26_1558133.04.jpeg", "transf_edesur_mercado_oct26_1558133.04.jpeg"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600588-transf_edesur_mio_oct26_1600000.pdf", "transf_edesur_mio_oct26_1600000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600546-transf_fuego_oct26_fc_172327_361132.pdf", "transf_fuego_oct26_fc_172327_361132.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600593-TRANSF_FUMIGACION_OCT26_FC_2451_102000.pdf", "TRANSF_FUMIGACION_OCT26_FC_2451_102000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600552-TRANSF_HERRERO_OCT26_CAJA_REPARACION_120000.pdf", "TRANSF_HERRERO_OCT26_CAJA_REPARACION_120000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600722-TRANSF_METROGAS_OCT26_28523.78.pdf", "TRANSF_METROGAS_OCT26_28523.78.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600599-transf_seguridad_oct26_fc_001_6440659.20.pdf", "transf_seguridad_oct26_fc_001_6440659.20.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600584-transf_sueldo_adelanto_oct26_300000.pdf", "transf_sueldo_adelanto_oct26_300000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448600727-RESUMEN_OCTUBRE_2026.pdf", "RESUMEN_OCTUBRE_2026.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617485-acuse_arca_septiembre26.pdf", "acuse_arca_septiembre26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618051-arca_931_septiembre26.pdf", "arca_931_septiembre26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617493-libro_de_sueldo_septiembre26.pdf", "libro_de_sueldo_septiembre26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618153-RECIBO_SUELDO_SEPTIEMBRE26_1543007.pdf", "RECIBO_SUELDO_SEPTIEMBRE26_1543007.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617948-transf_arca_vep_sept26_883840.56.pdf", "transf_arca_vep_sept26_883840.56.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617714-transf_sueldo_sept26_se_desc_adelanto_x_200000.pdf", "transf_sueldo_sept26_se_desc_adelanto_x_200000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617960-RESUMEN_SEPTIEMBRE_20226_1_.pdf", "RESUMEN_SEPTIEMBRE_20226_1_.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617506-FACTURA_JARDIN_SEPT26_FC369_180000.pdf", "FACTURA_JARDIN_SEPT26_FC369_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617484-FACTURA_JARDIN_AGOSTO26_FC366_180000.pdf", "FACTURA_JARDIN_AGOSTO26_FC366_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617814-FACTURA_HONORARIOS_SEPT26_680000.pdf", "FACTURA_HONORARIOS_SEPT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617480-factura_fumigacion_sep_26_fac_2451_102.000_directorio.pdf", "factura_fumigacion_sep_26_fac_2451_102.000_directorio.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617818-factura_edesur_sept26.pdf", "factura_edesur_sept26.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617505-FACTURA_CERRAJERO_SEPT26_FC107_900000.pdf", "FACTURA_CERRAJERO_SEPT26_FC107_900000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617514-factura_abogada_juicio_toledo_sept26_fc747_2da_instancia_2459070.90.pdf", "factura_abogada_juicio_toledo_sept26_fc747_2da_instancia_2459070.90.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617496-factura_abogada_juicio_toledo_sept26_fc746_1ra_instancia_4413717.pdf", "factura_abogada_juicio_toledo_sept26_fc746_1ra_instancia_4413717.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617996-FACTURA_DESTAPACION_SEPT26_FC9161_180000.pdf", "FACTURA_DESTAPACION_SEPT26_FC9161_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618069-FACTURA_FUEGO_SEPT26_CTA_8_DE_12_336137.71.pdf", "FACTURA_FUEGO_SEPT26_CTA_8_DE_12_336137.71.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618055-FACTURA_FUEGO_SEPT26_FC168784_357061.39.pdf", "FACTURA_FUEGO_SEPT26_FC168784_357061.39.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617731-transf_cerrajero_sept26_cerradura_a_cuenta_900000.pdf", "transf_cerrajero_sept26_cerradura_a_cuenta_900000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617728-transf_destapacion_sept26_fc9161_180000.pdf", "transf_destapacion_sept26_fc9161_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617715-transf_fumigacion_sept26_fc2423_99000.pdf", "transf_fumigacion_sept26_fc2423_99000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617726-TRANSF_JARDIN_SEPT26_FC366_180000.pdf", "TRANSF_JARDIN_SEPT26_FC366_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617729-transf_limpos_sept26_667246.84.pdf", "transf_limpos_sept26_667246.84.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617943-transf_metrogas_sept26_16352.24.pdf", "transf_metrogas_sept26_16352.24.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617716-transf_seguridad_sept26_fc3823_7856558.16.pdf", "transf_seguridad_sept26_fc3823_7856558.16.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617986-FACTURA_DESTAPACION_SEPT26_FC9162_96000.pdf", "FACTURA_DESTAPACION_SEPT26_FC9162_96000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618101-FACTURA_ELECTRICISTA_SEPT26_FC1372_100000.pdf", "FACTURA_ELECTRICISTA_SEPT26_FC1372_100000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618053-factura_electricista_sept26_fc1382_89000.pdf", "factura_electricista_sept26_fc1382_89000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617769-factura_gestionar_sept26_fc57284_65900.pdf", "factura_gestionar_sept26_fc57284_65900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618088-FACTURA_HERRERO_SEPT26_FC_306_BISAGRAS_80000.pdf", "FACTURA_HERRERO_SEPT26_FC_306_BISAGRAS_80000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617728-transf_control_remoto_porton_sept26_abonado_por_propietarios_jose_fc_1156_60500.pdf", "transf_control_remoto_porton_sept26_abonado_por_propietarios_jose_fc_1156_60500.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617730-transf_electricista_sept26_fc_89000.pdf", "transf_electricista_sept26_fc_89000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617706-TRANSF_ELECTRICISTA_SEPT26_FC1372_100000.pdf", "TRANSF_ELECTRICISTA_SEPT26_FC1372_100000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617725-TRANSF_HONORARIOS_SEPT26_680000.pdf", "TRANSF_HONORARIOS_SEPT26_680000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617748-TRANSF_PROPIETARIA_PEDALINO_DEVOLUCION_EXPENSAS_SEPT26_800000.pdf", "TRANSF_PROPIETARIA_PEDALINO_DEVOLUCION_EXPENSAS_SEPT26_800000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617705-transf_sueldo_adelanto_sept26_300000.pdf", "transf_sueldo_adelanto_sept26_300000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617639-FACTURA_ASCENSOR_SEPT26_FC58511_435900.PDF", "FACTURA_ASCENSOR_SEPT26_FC58511_435900.PDF"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618097-FACTURA_ELECTRICISTA_MATERIALES_SEPT26_47000.pdf", "FACTURA_ELECTRICISTA_MATERIALES_SEPT26_47000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618073-factura_electricista_materiales_sept26_69000.pdf", "factura_electricista_materiales_sept26_69000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448618087-factura_seguridad_sept26_fc50_6493021.92.pdf", "factura_seguridad_sept26_fc50_6493021.92.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617740-transf_abogada_juicio_sept26_fc747_2459070.90.pdf", "transf_abogada_juicio_sept26_fc747_2459070.90.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617744-transf_ascensor_sept26_fc58511_435900.pdf", "transf_ascensor_sept26_fc58511_435900.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617742-transf_destapacion_sept26_fc9162_96000.pdf", "transf_destapacion_sept26_fc9162_96000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617738-transf_edesur_sept26_1567000_mio.pdf", "transf_edesur_sept26_1567000_mio.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617741-transf_edesur_sept26_1567000.pdf", "transf_edesur_sept26_1567000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617749-transf_electricista_materiales_sept26_47000.pdf", "transf_electricista_materiales_sept26_47000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617746-transf_electricista_materiales_sept26_69000.pdf", "transf_electricista_materiales_sept26_69000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617741-TRANSF_FUEGO_SEPT26_FC163179_336137.71.pdf", "TRANSF_FUEGO_SEPT26_FC163179_336137.71.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617746-transf_herrero_sept26_visagras_80000.pdf", "transf_herrero_sept26_visagras_80000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617750-TRANSF_JARDIN_SEPT26_FC_369_180000.pdf", "TRANSF_JARDIN_SEPT26_FC_369_180000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617803-factura_limpos_sept26_fc111_667246.84.pdf", "factura_limpos_sept26_fc111_667246.84.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617704-factura_seguridad_sept26_fc3823_7856558.16.PDF", "factura_seguridad_sept26_fc3823_7856558.16.PDF"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617765-transf_abogada_juicio_sept26_fc746_4413717.pdf", "transf_abogada_juicio_sept26_fc746_4413717.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617809-transf_cartadocumento_4g_sep26_24000.pdf", "transf_cartadocumento_4g_sep26_24000.pdf"],
  ["staging/b1eabb53-e867-48bf-a434-7361aa8123eb/1795448617710-transf_seguridad_sept26_fc50_6493021.92.pdf", "transf_seguridad_sept26_fc50_6493021.92.pdf"]
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function html(cuerpo, status = 200) {
  return new Response(`<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:14px system-ui;padding:16px;line-height:1.5;word-break:break-all">${cuerpo}</body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
async function listarTodo(bucket, prefix) {
  const claves = [];
  let cursor;
  do {
    const r = await bucket.list({ prefix, cursor, limit: 1000 });
    claves.push(...r.objects.map(o => o.key));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return claves;
}
// Para cada renglón del manifest: ¿está en staging? ¿ya está en trabajos/31/?
function clasificar(enStaging, enTrabajos) {
  const setS = new Set(enStaging);
  const prefT = `trabajos/${PEDIDO}/`;
  return MANIFEST.map(([viejo, suf], i) => {
    const sinPrefijo = enTrabajos.filter(k => k.endsWith('-' + suf));
    let hallados = sinPrefijo;
    if (hallados.length > 1) {
      const pref = hallados.filter(k => k === `${prefT}${i + 1}-${suf}` || k === `${prefT}${i}-${suf}`);
      if (pref.length === 1) hallados = pref;
    }
    return {
      i, viejo, suf,
      destino: `${prefT}${i + 1}-${suf}`,
      enStaging: setS.has(viejo),
      enTrabajos: hallados.length === 1 ? hallados[0] : null,
      ambiguo: hallados.length > 1,
    };
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const secreto = url.searchParams.get('s');
  if (!env.PANEL_TO_WIZARD_SECRET || secreto !== env.PANEL_TO_WIZARD_SECRET) return html('No autorizado.', 401);
  const base = `${url.origin}${url.pathname}?s=${encodeURIComponent(secreto)}`;

  const enStaging = await listarTodo(env.BUCKET, SESION);
  const enTrabajos = await listarTodo(env.BUCKET, `trabajos/${PEDIDO}/`);
  const cl = clasificar(enStaging, enTrabajos);
  const soloStaging = cl.filter(c => c.enStaging && !c.enTrabajos);
  const yaMovidos = cl.filter(c => c.enTrabajos);
  const enNinguno = cl.filter(c => !c.enStaging && !c.enTrabajos);
  const ambiguos = cl.filter(c => c.ambiguo);
  const manifestKeys = new Set(MANIFEST.map(m => m[0]));
  const sobrantes = enStaging.filter(k => !manifestKeys.has(k));

  // ---------- SOLO LECTURA ----------
  if (url.searchParams.get('estado') === '1') {
    return html(
      `<p><b>Versión: reconciliación v3 (solo lectura)</b></p>` +
      `<p>Esperados: ${MANIFEST.length}<br>` +
      `En staging/ (sesión): ${enStaging.length}<br>` +
      `En trabajos/${PEDIDO}/: ${enTrabajos.length}</p>` +
      `<p>✅ Ya movidos a trabajos/${PEDIDO}/: <b>${yaMovidos.length}</b><br>` +
      `📦 Solo en staging (falta copiar): <b>${soloStaging.length}</b><br>` +
      `❌ En ningún lado: <b>${enNinguno.length}</b><br>` +
      `⚠️ Ambiguos: ${ambiguos.length}<br>` +
      `Objetos en staging que no están en el manifest: ${sobrantes.length}</p>` +
      (enNinguno.length ? `<p><b>Faltantes:</b><br>${enNinguno.map(c => `${c.i + 1}. ${esc(c.suf)}`).join('<br>')}</p>` : '') +
      (sobrantes.length ? `<p><b>Sobrantes:</b><br>${sobrantes.map(esc).join('<br>')}</p>` : '') +
      `<p><b>Primeras keys en trabajos/${PEDIDO}/:</b><br>${enTrabajos.slice(0, 5).map(k => esc(JSON.stringify(k))).join('<br>') || '(ninguna)'}</p>` +
      (soloStaging.length ? `<p><a href="${base}&desde=0"><b>Copiar los ${soloStaging.length} pendientes →</b></a></p>`
                          : `<p><a href="${base}&actualizar=1"><b>Siguiente: actualizar las keys →</b></a></p>`));
  }

  // ---------- COPIA (tandas) ----------
  if (url.searchParams.has('desde')) {
    const tanda = soloStaging.slice(0, TANDA); // siempre las primeras pendientes: al terminar cada una deja de ser pendiente
    const log = [];
    for (const c of tanda) {
      try {
        const obj = await env.BUCKET.get(c.viejo);
        if (!obj) { log.push(`❌ ${c.i + 1} no existe: ${esc(c.viejo)}`); continue; }
        await env.BUCKET.put(c.destino, obj.body, { httpMetadata: obj.httpMetadata });
        log.push(`✅ ${c.i + 1} ${esc(c.destino)}`);
      } catch (e) { log.push(`❌ ${c.i + 1} ${esc(e.message)}`); }
    }
    const quedan = soloStaging.length - tanda.length;
    return html(`<p>Copiados en esta tanda: ${tanda.length}. Pendientes después: ${quedan}</p>${log.join('<br>')}` +
      (quedan > 0 ? `<p><a href="${base}&desde=0"><b>Siguiente tanda →</b></a></p>`
                  : `<p><a href="${base}&estado=1"><b>Terminó. Volver a verificar →</b></a></p>`));
  }

  // ---------- ACTUALIZAR LA D1 ----------
  if (url.searchParams.get('actualizar') === '1') {
    if (soloStaging.length || enNinguno.length || ambiguos.length) {
      return html(`⛔ No se actualizó nada: todavía hay ${soloStaging.length} sin copiar, ${enNinguno.length} sin encontrar y ${ambiguos.length} ambiguos. Corré primero <a href="${base}&estado=1">estado</a>.`, 409);
    }
    try {
      const finales = cl.map(c => c.enTrabajos);
      const fila = await env.DB.prepare('SELECT configuracion FROM trabajos WHERE id = ?').bind(PEDIDO).first();
      const n = fila ? (JSON.parse(fila.configuracion).archivos || []).length : -1;
      if (n !== MANIFEST.length) return html(`⛔ El pedido ${PEDIDO} tiene ${n} archivos en configuracion y el manifest ${MANIFEST.length}. No se tocó nada.`, 409);
      // SQLite limita los argumentos por función: se parte en varios json_set de 25 pares, en un batch atómico.
      const POR_STMT = 25;
      const stmts = [];
      for (let ini = 0; ini < finales.length; ini += POR_STMT) {
        const trozo = finales.slice(ini, ini + POR_STMT);
        const sets = trozo.map((_, j) => `'$.archivos[${ini + j}].r2_key', ?`).join(', ');
        stmts.push(env.DB.prepare(`UPDATE trabajos SET configuracion = json_set(configuracion, ${sets}) WHERE id = ?`).bind(...trozo, PEDIDO));
      }
      await env.DB.batch(stmts);
      const chk = await env.DB.prepare(
        `SELECT SUM(json_extract(a.value,'$.r2_key') LIKE ?) AS ok, COUNT(*) AS total FROM trabajos t, json_each(t.configuracion,'$.archivos') a WHERE t.id = ?`
      ).bind(`trabajos/${PEDIDO}/%`, PEDIDO).first();
      return html(`✅ Actualizado en ${stmts.length} partes. Verificación: ${chk.ok} de ${chk.total} con key trabajos/${PEDIDO}/. Probá abrir un archivo y el .zip desde el Panel. Después borrá este archivo del repo.`);
    } catch (e) {
      return html(`❌ Error al actualizar (no se aplicó nada, el batch es atómico):<br>${esc(e.message)}`, 500);
    }
  }

  return html(`Modos: <a href="${base}&estado=1">estado (solo lectura)</a>`);
}
