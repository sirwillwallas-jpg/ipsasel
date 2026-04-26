import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { API_BASE_URL } from './src/config';

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
const REQUEST_TIMEOUT_MS = 8000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseISODate(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  return { year, month, day };
}

function formatISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getTodayISO() {
  return formatISODate(new Date());
}

function formatMonthTitle(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('es-VE', {
    month: 'long',
    year: 'numeric',
  });
}

function formatLongDateLabel(isoDate) {
  if (!isoDate) {
    return 'Sin fecha seleccionada';
  }

  const { year, month, day } = parseISODate(isoDate);
  return new Date(year, month - 1, day).toLocaleDateString('es-VE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function shiftMonth(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number);
  const nextMonth = new Date(year, month - 1 + delta, 1);
  return `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}`;
}

function getUserFriendlyError(error) {
  const rawMessage = String(error?.message || '').trim();
  const normalized = rawMessage.toLowerCase();

  if (
    !rawMessage ||
    normalized === 'failed to fetch' ||
    normalized === 'network request failed' ||
    normalized.includes('timeout') ||
    normalized.includes('tiempo de espera')
  ) {
    return `No se pudo conectar con el backend en ${API_BASE_URL}. Verifica que el servidor este activo y que el telefono o navegador este en la misma red.`;
  }

  return rawMessage;
}

async function fetchJsonWithTimeout(pathname, errorMessage) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${pathname}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La solicitud excedio el tiempo de espera.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildCalendarWeeks(monthKey, selectedDate, todayISO, eventCountByDate) {
  const [year, month] = monthKey.split('-').map(Number);
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPreviousMonth = new Date(year, month - 1, 0).getDate();
  const offset = (firstDayOfMonth.getDay() + 6) % 7;
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    let cellDate;
    let dayNumber;
    let isCurrentMonth = true;

    if (index < offset) {
      dayNumber = daysInPreviousMonth - offset + index + 1;
      cellDate = new Date(year, month - 2, dayNumber);
      isCurrentMonth = false;
    } else if (index >= offset + daysInMonth) {
      dayNumber = index - offset - daysInMonth + 1;
      cellDate = new Date(year, month, dayNumber);
      isCurrentMonth = false;
    } else {
      dayNumber = index - offset + 1;
      cellDate = new Date(year, month - 1, dayNumber);
    }

    const isoDate = formatISODate(cellDate);
    const eventCount = eventCountByDate[isoDate] || 0;

    cells.push({
      isoDate,
      dayNumber,
      eventCount,
      hasEvents: eventCount > 0,
      isCurrentMonth,
      isSelected: isoDate === selectedDate,
      isToday: isoDate === todayISO,
    });
  }

  const weeks = [];

  for (let weekIndex = 0; weekIndex < cells.length; weekIndex += 7) {
    weeks.push(cells.slice(weekIndex, weekIndex + 7));
  }

  return weeks;
}

function VisitCard({ visit }) {
  const visitCode = visit.codigo_visita || 'Sin codigo';
  const status = visit.estatus || 'Sin estatus';
  const entity = visit.entidad || visit.nombre_entidad || 'No aplica';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardCode}>{visitCode}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{status}</Text>
        </View>
      </View>

      <Text style={styles.cardLine}>Hora: {String(visit.hora || '').slice(0, 5) || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Tipo: {visit.tipo_visita || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Nombre: {visit.nombre_completo || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Entidad: {entity}</Text>
      <Text style={styles.cardLine}>Cedula/RIF: {visit.cedula_rif || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Telefono: {visit.telefono || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Codigo OT: {visit.codigo_ot || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Detalle OT: {visit.detalle_ot || 'No aplica'}</Text>
    </View>
  );
}

export default function App() {
  const todayISORef = useRef(getTodayISO());
  const todayISO = todayISORef.current;
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [visibleMonth, setVisibleMonth] = useState(todayISO.slice(0, 7));
  const [visits, setVisits] = useState([]);
  const [eventCountByDate, setEventCountByDate] = useState({});
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [error, setError] = useState('');
  const [calendarStatus, setCalendarStatus] = useState('Cargando calendario...');
  const selectedDateRef = useRef(todayISO);

  const loadVisitsByDate = useCallback(async (isoDate) => {
    if (!isoDate) {
      setVisits([]);
      return;
    }

    setLoadingVisits(true);
    setError('');

    try {
      const data = await fetchJsonWithTimeout(
        `/api/visitas-por-fecha?fecha=${encodeURIComponent(isoDate)}`,
        'No se pudo consultar las visitas de la fecha seleccionada.'
      );
      setVisits(Array.isArray(data.visits) ? data.visits : []);
    } catch (err) {
      setError(getUserFriendlyError(err));
      setVisits([]);
    } finally {
      setLoadingVisits(false);
    }
  }, []);

  const selectDate = useCallback((isoDate) => {
    selectedDateRef.current = isoDate;
    setSelectedDate(isoDate);
    setVisibleMonth(String(isoDate).slice(0, 7));
    loadVisitsByDate(isoDate);
  }, [loadVisitsByDate]);

  const loadCalendarData = useCallback(async () => {
    setLoadingCalendar(true);
    setLoadingVisits(true);
    setError('');
    setCalendarStatus('Cargando calendario...');

    try {
      const currentDate = selectedDateRef.current || todayISO;
      const [calendarData, visitsData] = await Promise.all([
        fetchJsonWithTimeout('/api/visitas-calendario-resumen', 'No se pudo cargar el calendario.'),
        fetchJsonWithTimeout(
          `/api/visitas-por-fecha?fecha=${encodeURIComponent(currentDate)}`,
          'No se pudo consultar las visitas de la fecha seleccionada.'
        ),
      ]);

      const dates = Array.isArray(calendarData.dates) ? calendarData.dates : [];
      const nextEventCountByDate = dates.reduce((accumulator, item) => {
        const dateKey = String(item.fecha || '').slice(0, 10);
        const total = Number(item.total || 0);
        if (dateKey) {
          accumulator[dateKey] = total;
        }
        return accumulator;
      }, {});
      const totalVisits = dates.reduce((sum, item) => sum + Number(item.total || 0), 0);

      setEventCountByDate(nextEventCountByDate);
      setVisits(Array.isArray(visitsData.visits) ? visitsData.visits : []);
      setCalendarStatus(`Calendario cargado. Fechas con visitas: ${dates.length}. Total: ${totalVisits}`);
    } catch (err) {
      setError(getUserFriendlyError(err));
      setCalendarStatus('Error al cargar el calendario.');
      setEventCountByDate({});
      setVisits([]);
    } finally {
      setLoadingCalendar(false);
      setLoadingVisits(false);
    }
  }, [todayISO]);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  const calendarWeeks = useMemo(() => (
    buildCalendarWeeks(visibleMonth, selectedDate, todayISO, eventCountByDate)
  ), [eventCountByDate, selectedDate, todayISO, visibleMonth]);

  const visibleMonthSummary = useMemo(() => {
    const datePrefix = `${visibleMonth}-`;
    let daysWithVisits = 0;
    let totalVisits = 0;

    Object.entries(eventCountByDate).forEach(([dateKey, count]) => {
      if (dateKey.startsWith(datePrefix)) {
        daysWithVisits += 1;
        totalVisits += count;
      }
    });

    return { daysWithVisits, totalVisits };
  }, [eventCountByDate, visibleMonth]);

  const selectedDateSummary = useMemo(() => {
    if (loadingVisits) {
      return 'Consultando visitas por fecha...';
    }

    return `Total de visitas para la fecha seleccionada: ${visits.length}`;
  }, [loadingVisits, visits.length]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Calendario de visitas</Text>
        <Text style={styles.subtitle}>
          Visualiza visitas de hoy y otros dias. Toca una fecha para ver su detalle.
        </Text>

        <View style={styles.actionsRow}>
          <Pressable
            style={[styles.refreshButton, (loadingCalendar || loadingVisits) && styles.refreshButtonDisabled]}
            onPress={() => loadCalendarData()}
            disabled={loadingCalendar || loadingVisits}
          >
            <Text style={styles.refreshText}>Actualizar</Text>
          </Pressable>
          <Pressable
            style={styles.todayButton}
            onPress={() => selectDate(todayISO)}
          >
            <Text style={styles.todayButtonText}>Hoy</Text>
          </Pressable>
        </View>

        <Text style={styles.statusRow}>{calendarStatus}</Text>
        <Text style={styles.apiHint}>API: {API_BASE_URL}</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.panel}>
          <View style={styles.monthHeader}>
            <Pressable
              style={styles.monthNavButton}
              onPress={() => setVisibleMonth((currentMonth) => shiftMonth(currentMonth, -1))}
            >
              <Text style={styles.monthNavButtonText}>{'<'}</Text>
            </Pressable>

            <View style={styles.monthTitleGroup}>
              <Text style={styles.monthTitle}>{formatMonthTitle(visibleMonth)}</Text>
              <Text style={styles.monthMeta}>
                Dias con visitas: {visibleMonthSummary.daysWithVisits} | Total: {visibleMonthSummary.totalVisits}
              </Text>
            </View>

            <Pressable
              style={styles.monthNavButton}
              onPress={() => setVisibleMonth((currentMonth) => shiftMonth(currentMonth, 1))}
            >
              <Text style={styles.monthNavButtonText}>{'>'}</Text>
            </Pressable>
          </View>

          {loadingCalendar ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator size="large" color="#1d4ed8" />
              <Text style={styles.loadingText}>Cargando calendario...</Text>
            </View>
          ) : (
            <>
              <View style={styles.weekdaysRow}>
                {WEEKDAY_LABELS.map((label) => (
                  <View key={label} style={styles.weekdayCell}>
                    <Text style={styles.weekdayText}>{label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.calendarGrid}>
                {calendarWeeks.map((week, weekIndex) => (
                  <View
                    key={`week-${week[0].isoDate}`}
                    style={[styles.weekRow, weekIndex > 0 && styles.weekRowSpaced]}
                  >
                    {week.map((dayItem) => (
                      <Pressable
                        key={dayItem.isoDate}
                        style={[
                          styles.dayCell,
                          !dayItem.isCurrentMonth && styles.dayCellMuted,
                          dayItem.hasEvents && dayItem.isCurrentMonth && styles.dayCellWithEvents,
                          dayItem.isToday && styles.dayCellToday,
                          dayItem.isSelected && styles.dayCellSelected,
                        ]}
                        onPress={() => selectDate(dayItem.isoDate)}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            !dayItem.isCurrentMonth && styles.dayNumberMuted,
                            dayItem.isSelected && styles.dayNumberSelected,
                          ]}
                        >
                          {dayItem.dayNumber}
                        </Text>

                        <View
                          style={[
                            styles.dayCountBadge,
                            !dayItem.hasEvents && styles.dayCountBadgeEmpty,
                            dayItem.isSelected && dayItem.hasEvents && styles.dayCountBadgeSelected,
                          ]}
                        >
                          {dayItem.hasEvents ? (
                            <Text
                              style={[
                                styles.dayCountText,
                                dayItem.isSelected && styles.dayCountTextSelected,
                              ]}
                            >
                              {dayItem.eventCount}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.legendText}>Toca un dia para consultar sus visitas.</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Detalle por fecha</Text>
          <Text style={styles.selectedDateLabel}>
            Fecha seleccionada: {formatLongDateLabel(selectedDate)}
          </Text>
          <Text style={styles.detailStatus}>{selectedDateSummary}</Text>

          {loadingVisits ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator size="large" color="#1d4ed8" />
              <Text style={styles.loadingText}>Cargando visitas...</Text>
            </View>
          ) : visits.length > 0 ? (
            <View style={styles.cardsList}>
              {visits.map((visit, index) => (
                <VisitCard
                  key={String(visit.codigo_visita || visit.cedula_rif || index)}
                  visit={visit}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>Sin resultados</Text>
              <Text style={styles.emptyText}>No hay visitas para la fecha seleccionada.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#edf4ff',
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 14,
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  refreshButton: {
    flex: 1,
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  refreshButtonDisabled: {
    opacity: 0.65,
  },
  refreshText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  todayButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayButtonText: {
    color: '#1e3a8a',
    fontWeight: '700',
  },
  statusRow: {
    marginBottom: 8,
    color: '#475569',
    fontWeight: '600',
  },
  apiHint: {
    marginBottom: 8,
    color: '#64748b',
    fontSize: 12,
  },
  errorText: {
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    fontWeight: '600',
  },
  panel: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    backgroundColor: '#ffffff',
    padding: 16,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  monthNavButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavButtonText: {
    color: '#1e3a8a',
    fontSize: 18,
    fontWeight: '800',
  },
  monthTitleGroup: {
    flex: 1,
    alignItems: 'center',
  },
  monthTitle: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  monthMeta: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
  },
  centerBlock: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#334155',
    fontSize: 13,
  },
  weekdaysRow: {
    flexDirection: 'row',
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 10,
  },
  weekdayText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  calendarGrid: {
    marginTop: 2,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 8,
  },
  weekRowSpaced: {
    marginTop: 8,
  },
  dayCell: {
    flex: 1,
    minHeight: 66,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: 'space-between',
  },
  dayCellMuted: {
    backgroundColor: '#f8fafc',
    opacity: 0.65,
  },
  dayCellWithEvents: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  dayCellToday: {
    borderColor: '#2563eb',
    borderWidth: 2,
  },
  dayCellSelected: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
    opacity: 1,
  },
  dayNumber: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 15,
  },
  dayNumberMuted: {
    color: '#94a3b8',
  },
  dayNumberSelected: {
    color: '#ffffff',
  },
  dayCountBadge: {
    minWidth: 24,
    alignSelf: 'flex-end',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
  },
  dayCountBadgeEmpty: {
    backgroundColor: 'transparent',
    minHeight: 18,
  },
  dayCountBadgeSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  dayCountText: {
    color: '#1e3a8a',
    fontSize: 11,
    fontWeight: '800',
  },
  dayCountTextSelected: {
    color: '#ffffff',
  },
  legendText: {
    marginTop: 14,
    color: '#1e3a8a',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  selectedDateLabel: {
    marginTop: 8,
    color: '#1e3a8a',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  detailStatus: {
    marginTop: 8,
    color: '#475569',
    fontWeight: '600',
  },
  cardsList: {
    marginTop: 14,
    gap: 10,
  },
  emptyBox: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    padding: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e3a8a',
  },
  emptyText: {
    marginTop: 6,
    color: '#334155',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 14,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardCode: {
    flex: 1,
    color: '#0f172a',
    fontWeight: '800',
  },
  badge: {
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: '#1e3a8a',
    fontSize: 11,
    fontWeight: '700',
  },
  cardLine: {
    color: '#334155',
    marginTop: 3,
  },
});
