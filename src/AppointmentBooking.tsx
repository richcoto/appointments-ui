import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  isSameMonth,
  isSameDay,
  eachDayOfInterval,
  startOfDay,
  isBefore,
} from "date-fns";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ---------- Types (aggregated availability endpoint) ----------
type Service = { id: number; name: string; durationMinutes?: number };
type EmployeeAvailability = {
  id: number;
  name: string;
  lastname?: string;
  services: Service[];
  slots: string[]; // "HH:mm"
};
type DayAvailability = {
  date: string; // 'yyyy-MM-dd' (we normalize if needed)
  employees: EmployeeAvailability[];
};
type AvailabilityResponse = {
  companyId: number;
  month: string; // 'yyyy-MM'
  days: DayAvailability[];
};

// POST payload
type CreateAppointmentPayload = {
  companyId: number;
  serviceId: number;
  name: string;
  whatsappNumber: string;
  dateTime: string; // ISO 'Z'
  note?: string;
  employeeId: number;
};

// ---------- Config ----------
const API_BASE =
  (import.meta.env.VITE_API_BASE as string) ?? "http://localhost:8080";
const COMPANY_ID = (import.meta.env.VITE_COMPANY_ID as string) ?? "1";

// ---------- Helpers ----------
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ` – ${txt}` : ""}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

// Normalize any string/Date into 'yyyy-MM-dd'
function toKey(d: string | Date): string {
  if (d instanceof Date) return format(startOfDay(d), "yyyy-MM-dd");
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const parsed = new Date(d);
  if (!isNaN(parsed.getTime())) return format(startOfDay(parsed), "yyyy-MM-dd");
  // final fallback
  const fallback = new Date(`${d}T00:00:00`);
  return format(startOfDay(fallback), "yyyy-MM-dd");
}

// Build ISO UTC from local date + "HH:mm"
function buildDateTimeISO(date: Date, hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map((n) => parseInt(n, 10));
  const local = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    isNaN(hh) ? 0 : hh,
    isNaN(mm) ? 0 : mm,
    0,
    0
  );
  return local.toISOString();
}

export default function AppointmentBooking(): JSX.Element {
  // ---------------- Left column (details) ----------------
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  // Preselect service via query param (optional)
  const initialServiceId = React.useMemo(() => {
    const p = new URLSearchParams(window.location.search).get("serviceId");
    return p ?? "";
  }, []);

  const [serviceId, setServiceId] = useState<string>(initialServiceId);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  // ---------------- Calendar / availability ----------------
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeFetch = useRef<AbortController | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);

  // Fetch function (used on month change & after successful booking)
  const fetchMonthAvailability = React.useCallback(
    async (targetMonth: Date) => {
      if (activeFetch.current) activeFetch.current.abort();
      const controller = new AbortController();
      activeFetch.current = controller;

      try {
        setLoadingAvailability(true);
        setError("");
        const monthParam = format(targetMonth, "yyyy-MM");
        const data = await api<AvailabilityResponse>(
          `/api/${COMPANY_ID}/availability?month=${monthParam}`,
          { signal: controller.signal }
        );
        setAvailability({
          ...data,
          days: data.days.map((d) => ({ ...d, date: toKey(d.date) })),
        });
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load availability");
      } finally {
        setLoadingAvailability(false);
      }
    },
    []
  );

  // Fetch when month changes
  useEffect(() => {
    fetchMonthAvailability(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Build quick day lookup + AVAILABLE DAY SET **based on current filters**
  const { daysByKey, availableDaySet } = useMemo(() => {
    const map = new Map<string, DayAvailability>();
    const set = new Set<string>();
    const today = startOfDay(new Date());

    if (availability) {
      for (const d of availability.days) {
        const key = toKey(d.date);
        map.set(key, d);

        const dayObj = new Date(`${key}T00:00:00`);
        if (isBefore(startOfDay(dayObj), today)) continue;

        // Filter logic depending on selected employee/service
        let dayHasAvailability = false;

        if (employeeId) {
          const emp = d.employees?.find((e) => String(e.id) === employeeId);
          if (emp && (emp.slots?.length ?? 0) > 0) {
            // if service is chosen, ensure this employee can do it
            dayHasAvailability = serviceId
              ? emp.services?.some((s) => String(s.id) === serviceId) ?? false
              : true;
          }
        } else if (serviceId) {
          // No employee picked: any employee who can do this service and has slots
          dayHasAvailability = d.employees?.some(
            (e) =>
              (e.slots?.length ?? 0) > 0 &&
              e.services?.some((s) => String(s.id) === serviceId)
          ) ?? false;
        } else {
          // No filters: any employee with slots
          dayHasAvailability = d.employees?.some((e) => (e.slots?.length ?? 0) > 0) ?? false;
        }

        if (dayHasAvailability) set.add(key);
      }
    }

    return { daysByKey: map, availableDaySet: set };
  }, [availability, employeeId, serviceId]);

  // Earliest available day considering current filters
  const earliestAvailableDate = useMemo<Date | null>(() => {
    if (!availability || availableDaySet.size === 0) return null;
    const keys = availability.days
      .map((d) => toKey(d.date))
      .filter((k) => availableDaySet.has(k))
      .sort();
    return keys.length ? new Date(`${keys[0]}T00:00:00`) : null;
  }, [availability, availableDaySet]);

  // Ensure selectedDate remains valid for the current filters; otherwise jump to earliest
  useEffect(() => {
    if (!availability) return;
    const valid = selectedDate ? availableDaySet.has(toKey(selectedDate)) : false;
    if (!valid) {
      if (earliestAvailableDate) {
        setSelectedDate(earliestAvailableDate);
      } else {
        // No availability with current filters
        setSelectedDate(null);
        setSelectedSlot("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability, availableDaySet, earliestAvailableDate, employeeId, serviceId]);

  // Month grid days
  const monthDays = useMemo(() => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    return eachDayOfInterval({ start, end });
  }, [month]);

  // Data for the selected day
  const selectedDayData = useMemo<DayAvailability | null>(() => {
    if (!availability || !selectedDate) return null;
    return daysByKey.get(toKey(selectedDate)) ?? null;
  }, [availability, selectedDate, daysByKey]);

  // Employees for the selected day (≥1 slot) and optional service filter
  const employeesForUI = useMemo<EmployeeAvailability[]>(() => {
    if (!selectedDayData) return [];
    const base = (selectedDayData.employees ?? []).filter((e) => (e.slots?.length ?? 0) > 0);
    if (!serviceId) return base;
    return base.filter((e) => e.services?.some((s) => String(s.id) === serviceId));
  }, [selectedDayData, serviceId]);

  // Services for UI: from selected employee if chosen; otherwise union of day employees (≥1 slot)
  const servicesForUI = useMemo<Service[]>(() => {
    if (!selectedDayData) return [];
    if (employeeId) {
      const emp = selectedDayData.employees.find((e) => String(e.id) === employeeId);
      return emp?.services ?? [];
    }
    const map = new Map<number, Service>();
    for (const e of selectedDayData.employees ?? []) {
      if ((e.slots?.length ?? 0) === 0) continue;
      for (const s of e.services ?? []) map.set(s.id, s);
    }
    return Array.from(map.values());
  }, [selectedDayData, employeeId]);

  // Slots for UI come strictly from the selected employee on that day
  const slotsForUI = useMemo<string[]>(() => {
    if (!selectedDayData || !employeeId) return [];
    const emp = selectedDayData.employees.find((e) => String(e.id) === employeeId);
    return emp?.slots ?? [];
  }, [selectedDayData, employeeId]);

  // Reset time when date changes
  useEffect(() => {
    setSelectedSlot("");
    setTimeOpen(false);
  }, [selectedDate]);

  // If picking an employee that can't perform the current service, clear the service
  useEffect(() => {
    if (!employeeId || !selectedDayData) return;
    const emp = selectedDayData.employees.find((e) => String(e.id) === employeeId);
    if (!emp) return;

    if (serviceId && !emp.services.some((s) => String(s.id) === serviceId)) {
      setServiceId("");
    }

    // If the currently selected date has no slots for this employee, jump to earliest day for them
    const hasSlotsToday = (emp.slots?.length ?? 0) > 0 && selectedDayData === daysByKey.get(toKey(selectedDate ?? new Date()));
    const canToday = hasSlotsToday && (!serviceId || emp.services.some((s) => String(s.id) === serviceId));
    if (!canToday && earliestAvailableDate) {
      setSelectedDate(earliestAvailableDate);
    }

    setSelectedSlot("");
    setTimeOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  // If service changes and current employee can't do it, clear employee & time
  useEffect(() => {
    if (!serviceId || !employeeId || !selectedDayData) return;
    const emp = selectedDayData.employees.find((e) => String(e.id) === employeeId);
    if (!emp || !emp.services.some((s) => String(s.id) === serviceId)) {
      setEmployeeId("");
      setSelectedSlot("");
      setTimeOpen(false);
    }
  }, [serviceId, employeeId, selectedDayData]);

  // --- Validation & Submit ---
  const canReserve =
    !!name && !!phone && !!serviceId && !!selectedSlot && !!selectedDate && !!employeeId && !submitting;

  const handleSubmit = async () => {
    setError("");
    if (!canReserve || !selectedDate) return;

    setSubmitting(true);
    try {
      const payload: CreateAppointmentPayload = {
        companyId: Number(COMPANY_ID),
        serviceId: Number(serviceId),
        name,
        whatsappNumber: phone,
        dateTime: buildDateTimeISO(selectedDate, selectedSlot),
        note: note || undefined,
        employeeId: Number(employeeId),
      };

      await api(`/api/${COMPANY_ID}/appointments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Refresh month so the just-booked slot disappears
      await fetchMonthAvailability(month);

      alert("Reserva creada ✅");
      setSelectedSlot("");
      setNote("");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear la reserva");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Calendar helpers ---
  const today = startOfDay(new Date());
  const isDisabledDay = (d: Date) => {
    const outside = !isSameMonth(d, month);
    const isPast = isBefore(startOfDay(d), today);
    const ds = toKey(d);
    const allowed = availableDaySet.has(ds);
    return outside || isPast || !allowed;
  };
  const monthLabel = format(month, "LLLL yyyy");
  const canOpenTime = !!employeeId && !!selectedDate && slotsForUI.length > 0;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <h1 className="text-xl font-semibold mb-4">Book an appointment</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Details */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name <span className="text-red-500">*</span></Label>
                <Input
                  id="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">WhatsApp / Phone <span className="text-red-500">*</span></Label>
                <Input
                  id="phone"
                  placeholder="+506 ..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Service <span className="text-red-500">*</span></Label>
                <Select value={serviceId} onValueChange={(v) => setServiceId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={loadingAvailability ? "Loading..." : "Select service"} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999] bg-white border shadow-md">
                    {servicesForUI.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}{s.durationMinutes ? ` (${s.durationMinutes} min)` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={employeeId} onValueChange={(v) => setEmployeeId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={loadingAvailability ? "Loading..." : "Select employee"} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999] bg-white border shadow-md">
                    {employeesForUI.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.lastname ? `${e.name} ${e.lastname}` : e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!employeeId && (
                  <p className="text-xs text-gray-500 mt-1">
                    Selecciona un colaborador para ver los horarios disponibles.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Input
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything to add?"
                />
              </div>

              <Button className="w-full" disabled={!canReserve} onClick={handleSubmit}>
                Reserve
              </Button>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </CardContent>
          </Card>
        </div>

        {/* Right: Date & Time */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <span>Pick a date & time</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Month header */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => setMonth((m) => addMonths(m, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-medium capitalize">{monthLabel}</div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => setMonth((m) => addMonths(m, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
                  <div key={w} className="text-center text-xs text-gray-500 py-1">
                    {w}
                  </div>
                ))}

                {monthDays.map((d) => {
                  const disabled = isDisabledDay(d);
                  const selected = selectedDate ? isSameDay(d, selectedDate) : false;

                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      onClick={() => {
                        if (disabled) return;
                        setSelectedDate(d);
                      }}
                      className={[
                        "h-9 rounded border text-sm",
                        disabled
                          ? "bg-gray-50 text-gray-300 cursor-not-allowed opacity-60"
                          : selected
                          ? "bg-black text-white border-black"
                          : "bg-white hover:bg-gray-100",
                      ].join(" ")}
                      title={
                        disabled
                          ? isBefore(startOfDay(d), today)
                            ? "You cannot select past days"
                            : "No availability for this day"
                          : undefined
                      }
                    >
                      {format(d, "d")}
                    </button>
                  );
                })}
              </div>

              {/* Time picker */}
              <div className="space-y-2">
                <Label>
                  Time <span className="text-red-500">*</span>
                </Label>
                <Popover open={timeOpen} onOpenChange={setTimeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      disabled={!canOpenTime}
                    >
                      <span>{selectedSlot || "Select time"}</span>
                      <Clock className="h-4 w-4 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[320px] p-2 bg-white border shadow-md"
                    align="start"
                  >
                    {slotsForUI.length === 0 ? (
                      <div className="text-sm text-gray-500 px-1 py-2">
                        {employeeId
                          ? "No hay horarios para este colaborador en este día."
                          : "Selecciona un colaborador primero."}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {slotsForUI.map((s) => (
                          <Button
                            key={s}
                            variant={s === selectedSlot ? "default" : "outline"}
                            className="h-9"
                            onClick={() => {
                              setSelectedSlot(s);
                              setTimeOpen(false);
                            }}
                          >
                            {s}
                          </Button>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                {!employeeId && (
                  <p className="text-xs text-gray-500">Selecciona un colaborador para ver horas.</p>
                )}
              </div>

              {loadingAvailability && (
                <p className="text-xs text-gray-500">Loading availability…</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
