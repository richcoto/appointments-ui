import React, { useEffect, useMemo, useState } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  isSameMonth,
  isSameDay,
  eachDayOfInterval,
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

type Employee = { id: number; name: string };
type CreateAppointmentRequest = {
  name: string;
  whatsappNumber: string;
  employeeId: number;
  appointmentDate: string; // yyyy-MM-dd
  appointmentTime: string; // HH:mm:ss
  note?: string;
  serviceId: number;
};

const API_BASE =
  (import.meta.env.VITE_API_BASE as string) ?? "http://localhost:8080";
const COMPANY_ID = (import.meta.env.VITE_COMPANY_ID as string) ?? "1";

// Small typed fetch helper
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} – ${txt}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export default function AppointmentBooking(): JSX.Element {
  // Left column
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [employeeId, setEmployeeId] = useState<string>(""); // keep as string for <Select>

  // Calendar & slots
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  // Data
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState<boolean>(false);
  const [loadingSlots, setLoadingSlots] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Optionally get serviceId from ?serviceId=…; fallback to 1
  const serviceId = useMemo<number>(() => {
    const p = new URLSearchParams(window.location.search).get("serviceId");
    const n = Number(p);
    return Number.isFinite(n) && n > 0 ? n : 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load employees once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingEmployees(true);
        const data = await api<Employee[]>(`/api/${COMPANY_ID}/employee`);
        if (!cancelled) setEmployees(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load employees");
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Clear selected time when employee or date changes
  useEffect(() => {
    setSelectedSlot("");
  }, [employeeId, selectedDate]);

  // Load slots each time employee/date changes
  useEffect(() => {
    const ready = employeeId && selectedDate;
    if (!ready) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoadingSlots(true);
        const day = format(selectedDate!, "yyyy-MM-dd");
        // expect string[] of "HH:mm" (adjust if your API returns a different shape)
        const r = await api<string[]>(
          `/api/${COMPANY_ID}/employee/${employeeId}/availability?date=${day}`
        );
        if (!cancelled) setSlots(r ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load availability");
        if (!cancelled) setSlots([]);
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, selectedDate]);

  const daysInMonth = useMemo(() => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    return eachDayOfInterval({ start, end });
  }, [month]);

  const canSubmit =
    !!name &&
    !!phone &&
    !!employeeId &&
    !!selectedDate &&
    !!selectedSlot &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit || !selectedDate) return;
    setSubmitting(true);
    setError("");
    try {
      const payload: CreateAppointmentRequest = {
        name,
        whatsappNumber: phone,
        employeeId: Number(employeeId),
        appointmentDate: format(selectedDate, "yyyy-MM-dd"),
        appointmentTime: `${selectedSlot}:00`, // ensure HH:mm:ss
        note: note || undefined,
        serviceId,
      };
      await api(`/api/${COMPANY_ID}/appointment`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      alert("Appointment created ✅");
      setSelectedSlot("");
      setNote("");
    } catch (e: any) {
      setError(e?.message ?? "Failed to create appointment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <h1 className="text-2xl font-semibold mb-4">Book an appointment</h1>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {/* Left: details */}
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">WhatsApp / Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+506 ..."
                />
              </div>
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select
                  value={employeeId}
                  onValueChange={(v) => setEmployeeId(v)}
                  disabled={loadingEmployees}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={loadingEmployees ? "Loading..." : "Select employee"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <Button className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
                {submitting ? "Saving…" : "Accept"}
              </Button>
            </CardContent>
          </Card>

          {/* Right: calendar + slots */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Pick a date & time
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Month controls */}
              <div className="flex items-center justify-between mb-3">
                <button
                  className="p-2 rounded border bg-white hover:bg-gray-100"
                  onClick={() => setMonth(addMonths(month, -1))}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="font-medium">{format(month, "MMMM yyyy")}</div>
                <button
                  className="p-2 rounded border bg-white hover:bg-gray-100"
                  onClick={() => setMonth(addMonths(month, 1))}
                  aria-label="Next month"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              {/* Calendar grid (simple 7×N just for current month days) */}
              <div className="grid grid-cols-7 gap-1 text-center text-sm mb-4">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="py-1 text-gray-500">
                    {d}
                  </div>
                ))}
                {daysInMonth.map((d) => {
                  const isSelected = selectedDate && isSameDay(d, selectedDate);
                  const outside = !isSameMonth(d, month); // should be false because we only render current month
                  return (
                    <button
                      key={d.toISOString()}
                      onClick={() => setSelectedDate(d)}
                      className={[
                        "h-9 rounded border",
                        outside ? "text-gray-300" : "",
                        isSelected
                          ? "bg-black text-white border-black"
                          : "bg-white hover:bg-gray-100"
                      ].join(" ")}
                    >
                      {format(d, "d")}
                    </button>
                  );
                })}
              </div>

              {/* Slots */}
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-600">
                  {employeeId && selectedDate
                    ? loadingSlots
                      ? "Loading available times…"
                      : slots.length
                      ? "Select a time:"
                      : "No times for this day."
                    : "Pick an employee and date to see times."}
                </span>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {slots.map((t) => {
                  const selected = selectedSlot === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setSelectedSlot(t)}
                      className={[
                        "px-2 py-1 rounded border bg-white text-sm",
                        selected
                          ? "bg-black text-white border-black"
                          : "hover:bg-gray-100 border-gray-200",
                      ].join(" ")}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
