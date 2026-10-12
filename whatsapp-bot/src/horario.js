// Calcula si un negocio esta abierto segun su horario y la zona horaria
// configurada (por defecto America/Lima, asi funciona igual aunque la PC
// tenga otra hora).

const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const NOMBRES_DIAS = {
  lun: 'Lunes', mar: 'Martes', mie: 'Miércoles', jue: 'Jueves',
  vie: 'Viernes', sab: 'Sábado', dom: 'Domingo',
};

function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Devuelve { dia: 'lun'..'dom', minutos: minutos desde las 00:00 } en la zona horaria dada.
function horaLocal(fecha, zonaHoraria) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  const indiceDia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(valor('weekday'));
  return {
    dia: DIAS[indiceDia],
    diaAnterior: DIAS[(indiceDia + 6) % 7],
    minutos: Number(valor('hour')) * 60 + Number(valor('minute')),
  };
}

// Un rango [abre, cierra] puede cruzar la medianoche (ej. ["18:00", "02:00"]).
function estaAbierto(horario, fecha, zonaHoraria) {
  const { dia, diaAnterior, minutos } = horaLocal(fecha, zonaHoraria);
  const hoy = horario[dia];
  if (hoy) {
    const abre = aMinutos(hoy[0]);
    const cierra = aMinutos(hoy[1]);
    if (cierra > abre ? minutos >= abre && minutos < cierra : minutos >= abre) return true;
  }
  const ayer = horario[diaAnterior];
  if (ayer) {
    const abre = aMinutos(ayer[0]);
    const cierra = aMinutos(ayer[1]);
    if (cierra <= abre && minutos < cierra) return true;
  }
  return false;
}

function horarioDeHoy(horario, fecha, zonaHoraria) {
  const { dia } = horaLocal(fecha, zonaHoraria);
  const hoy = horario[dia];
  return hoy ? `${hoy[0]} a ${hoy[1]}` : 'cerrado';
}

function textoHorario(horario) {
  return ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']
    .map((d) => `• ${NOMBRES_DIAS[d]}: ${horario[d] ? `${horario[d][0]} a ${horario[d][1]}` : 'cerrado'}`)
    .join('\n');
}

module.exports = { estaAbierto, horarioDeHoy, textoHorario, horaLocal };
