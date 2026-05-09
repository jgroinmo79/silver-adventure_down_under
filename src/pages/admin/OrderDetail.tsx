import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Loader2, ArrowLeft, Save, Share2, Copy, Check, Gift, AlertTriangle, Flower2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONUMENT_PRICES, ADD_ONS, MAINTENANCE_PLANS, FLOWER_PLANS, FLOWER_ONLY_PLANS } from "@/lib/pricing";
import PhotoUpload from "@/components/admin/PhotoUpload";
import ServiceLogForm from "@/components/admin/ServiceLogForm";
import { computeSubscriptionVisits } from "@/lib/subscription-schedule";
import { format } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

type OrderStatus = Database["public"]["Enums"]["order_status"];
type MonumentType = Database["public"]["Enums"]["monument_type"];
type MaterialType = Database["public"]["Enums"]["material_type"];


const ORDER_STATUSES: OrderStatus[] = ["pending", "confirmed", "scheduled", "in_progress", "completed", "cancelled"];
const MONUMENT_TYPES: MonumentType[] = ["single_marker", "double_marker", "single_slant", "single_upright", "double_slant", "double_upright", "grave_ledger"];
const MATERIALS: MaterialType[] = ["granite", "marble", "bronze", "mixed"];

const AdminOrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useQuery({
    queryKey: ["admin-order-detail", id],
    queryFn: async () => {
      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .select(`*, monuments (*)`)
        .eq("id", id ?? "")
        .single();
      if (orderError) throw orderError;

      // Fetch profile separately since there's no FK from orders to profiles
      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, email, phone, address, city, state, zip")
        .eq("user_id", orderData.user_id)
        .single();

      return { ...orderData, profiles: profileData };
    },
    enabled: !!id,
  });

  // Companion subscription (if this booking includes an annual plan with flower placements)
  const monumentIdForSub = (order?.monuments as any)?.id;
  const { data: subscription } = useQuery({
    queryKey: ["admin-order-subscription", monumentIdForSub],
    enabled: !!monumentIdForSub,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, plan, status, important_dates, start_date, user_id, monument_id")
        .eq("monument_id", monumentIdForSub!)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Build paired visit schedule: each flower placement is anchored, and the cleaning
  // visit on that same date is implicitly bundled (cleaning_flowers visits handle this).
  const pairedSchedule = (() => {
    if (!subscription || !order) return null;
    const customerName =
      (order.profiles as any)?.full_name ||
      (order.profiles as any)?.email ||
      (order as any).shopper_name ||
      "Customer";
    const cemeteryName = (order.monuments as any)?.cemetery_name ?? "Unknown";
    const startYear = new Date(subscription.start_date + "T00:00:00").getFullYear();
    const visits = [
      ...computeSubscriptionVisits(
        {
          id: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
          important_dates: subscription.important_dates,
          start_date: subscription.start_date,
          customerName,
          cemeteryName,
        },
        startYear
      ),
      ...computeSubscriptionVisits(
        {
          id: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
          important_dates: subscription.important_dates,
          start_date: subscription.start_date,
          customerName,
          cemeteryName,
        },
        startYear + 1
      ),
    ].sort((a, b) => a.date.localeCompare(b.date));
    return visits;
  })();

  // --- Schedule Optimizer state (persisted to localStorage; no schema changes) ---
  type OptimizerSlot = {
    key: string;
    placementDate: string | null; // yyyy-MM-dd, null if no flower
    cleaningDate: string;         // yyyy-MM-dd
    paired: boolean;              // true => single trip "Clean + Place"
  };
  const [optimizerSlots, setOptimizerSlots] = useState<OptimizerSlot[]>([]);
  const [scheduleApproved, setScheduleApproved] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);

  const optimizerStorageKey = id ? `schedule-optimizer:${id}` : null;

  // Build initial optimizer slots from computed visit schedule
  useEffect(() => {
    if (!optimizerStorageKey) return;

    // Try to load saved state first
    const saved = localStorage.getItem(optimizerStorageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.slots)) {
          setOptimizerSlots(parsed.slots);
          setScheduleApproved(!!parsed.approved);
          setApprovedAt(parsed.approvedAt ?? null);
          return;
        }
      } catch {}
    }

    if (!pairedSchedule || pairedSchedule.length === 0) {
      setOptimizerSlots([]);
      return;
    }

    const slots: OptimizerSlot[] = pairedSchedule.map((v) => ({
      key: v.id,
      placementDate: v.type === "cleaning_flowers" ? v.date : null,
      cleaningDate: v.date,
      paired: v.type === "cleaning_flowers",
    }));
    setOptimizerSlots(slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimizerStorageKey, pairedSchedule?.length]);

  const persistOptimizer = (slots: OptimizerSlot[], approved: boolean, approvedAtIso: string | null) => {
    if (!optimizerStorageKey) return;
    localStorage.setItem(
      optimizerStorageKey,
      JSON.stringify({ slots, approved, approvedAt: approvedAtIso })
    );
  };

  const updateSlot = (key: string, patch: Partial<OptimizerSlot>) => {
    if (scheduleApproved) return;
    setOptimizerSlots((prev) => {
      const next = prev.map((s) => {
        if (s.key !== key) return s;
        const merged = { ...s, ...patch };
        // If user changes cleaning date away from placement date, treat as unpaired
        if (merged.placementDate && merged.cleaningDate !== merged.placementDate) {
          merged.paired = false;
        }
        // If user pairs back, snap cleaning to placement date
        if (patch.paired === true && merged.placementDate) {
          merged.cleaningDate = merged.placementDate;
        }
        return merged;
      });
      persistOptimizer(next, false, null);
      return next;
    });
  };

  // Detect clustering: any two placement dates within 60 days
  const clusterWarning = (() => {
    if (!optimizerSlots.length) return null;
    const dates = optimizerSlots
      .filter((s) => !!s.placementDate)
      .map((s) => {
        const [y, m, d] = s.placementDate!.split("-").map(Number);
        return new Date(y, m - 1, d);
      })
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length < 2) return null;
    const pairs: { a: Date; b: Date; days: number }[] = [];
    for (let i = 0; i < dates.length - 1; i++) {
      const days = Math.round((dates[i + 1].getTime() - dates[i].getTime()) / 86400000);
      if (days < 60) pairs.push({ a: dates[i], b: dates[i + 1], days });
    }
    return pairs.length ? pairs : null;
  })();

  const approveSchedule = useMutation({
    mutationFn: async () => {
      // Earliest visit becomes the order's scheduled_date so it appears on the main calendar
      const allDates = optimizerSlots
        .flatMap((s) => [s.cleaningDate, s.placementDate].filter(Boolean) as string[])
        .sort();
      if (allDates.length > 0) {
        const { error } = await supabase
          .from("orders")
          .update({ scheduled_date: allDates[0], status: "scheduled" })
          .eq("id", id ?? "");
        if (error) throw error;
      }
    },
    onSuccess: () => {
      const nowIso = new Date().toISOString();
      setScheduleApproved(true);
      setApprovedAt(nowIso);
      persistOptimizer(optimizerSlots, true, nowIso);
      queryClient.invalidateQueries({ queryKey: ["admin-order-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-scheduled-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-orders"] });
      toast({ title: "Schedule approved", description: "Visits pushed to the main calendar." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const unlockSchedule = () => {
    setScheduleApproved(false);
    setApprovedAt(null);
    persistOptimizer(optimizerSlots, false, null);
  };

  // Order fields
  const [status, setStatus] = useState<OrderStatus>("pending");
  
  const [basePrice, setBasePrice] = useState("");
  const [travelFee, setTravelFee] = useState("");
  const [addOnsTotal, setAddOnsTotal] = useState("");
  const [bundlePrice, setBundlePrice] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [isVeteran, setIsVeteran] = useState(false);
  const [notes, setNotes] = useState("");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [bundleId, setBundleId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");

  // Monument fields
  const [cemeteryName, setCemeteryName] = useState("");
  const [monumentType, setMonumentType] = useState<MonumentType>("single_marker");
  const [material, setMaterial] = useState<MaterialType>("granite");
  const [estimatedMiles, setEstimatedMiles] = useState("");
  const [section, setSection] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [approximateHeight, setApproximateHeight] = useState("");
  const [condMoss, setCondMoss] = useState(false);
  const [condChipping, setCondChipping] = useState(false);
  const [condLeaning, setCondLeaning] = useState(false);
  const [condFaded, setCondFaded] = useState(false);
  const [condNotCleaned, setCondNotCleaned] = useState(false);
  const [knownDamage, setKnownDamage] = useState(false);

  // Customer fields
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custCity, setCustCity] = useState("");
  const [custState, setCustState] = useState("");
  const [custZip, setCustZip] = useState("");

  useEffect(() => {
    if (!order) return;
    const m = order.monuments as any;
    const p = order.profiles as any;

    setStatus(order.status);
    
    setBasePrice(String(order.base_price));
    setTravelFee(String(order.travel_fee));
    setAddOnsTotal(String(order.add_ons_total ?? 0));
    setBundlePrice(String(order.bundle_price ?? 0));
    setTotalPrice(String(order.total_price));
    setIsVeteran(order.is_veteran ?? false);
    setNotes(order.notes ?? "");
    setBundleId(order.bundle_id ?? "");
    setScheduledDate(order.scheduled_date ?? "");
    
    // Parse add_ons
    const parsedAddOns = Array.isArray(order.add_ons) ? (order.add_ons as string[]) : [];
    setAddOns(parsedAddOns);

    if (m) {
      setCemeteryName(m.cemetery_name ?? "");
      setMonumentType(m.monument_type);
      setMaterial(m.material);
      setEstimatedMiles(String(m.estimated_miles ?? 0));
      setSection(m.section ?? "");
      setLotNumber(m.lot_number ?? "");
      setApproximateHeight(m.approximate_height ?? "");
      setCondMoss(m.condition_moss_algae ?? false);
      setCondChipping(m.condition_chipping ?? false);
      setCondLeaning(m.condition_leaning ?? false);
      setCondFaded(m.condition_faded_inscription ?? false);
      setCondNotCleaned(m.condition_not_cleaned ?? false);
      setKnownDamage(m.known_damage ?? false);
    }

    if (p) {
      setCustName(p.full_name ?? "");
      setCustEmail(p.email ?? "");
      setCustPhone(p.phone ?? "");
      setCustAddress(p.address ?? "");
      setCustCity(p.city ?? "");
      setCustState(p.state ?? "");
      setCustZip(p.zip ?? "");
    }
  }, [order]);

  // Auto-save status and scheduled date immediately
  const quickSave = useMutation({
    mutationFn: async (fields: { status?: OrderStatus; scheduled_date?: string | null }) => {
      const { error } = await supabase
        .from("orders")
        .update(fields)
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-scheduled-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-unscheduled-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar-orders"] });
      toast({ title: "Saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    },
  });

  const handleStatusChange = (v: string) => {
    setStatus(v as OrderStatus);
    quickSave.mutate({ status: v as OrderStatus });
  };

  const handleDateChange = (v: string) => {
    setScheduledDate(v);
    quickSave.mutate({ scheduled_date: v || null });
  };

  const saveAll = useMutation({
    mutationFn: async () => {
      // Update order
      const { error: orderErr } = await supabase
        .from("orders")
        .update({
          status,
          base_price: Number(basePrice),
          travel_fee: Number(travelFee),
          add_ons_total: Number(addOnsTotal),
          bundle_price: Number(bundlePrice),
          total_price: Number(totalPrice),
          is_veteran: isVeteran,
          notes: notes || null,
          add_ons: addOns as any,
          bundle_id: bundleId || null,
          scheduled_date: scheduledDate || null,
        })
        .eq("id", id!);
      if (orderErr) throw orderErr;

      // Update monument
      const monumentId = (order?.monuments as any)?.id;
      if (monumentId) {
        const { error: monErr } = await supabase
          .from("monuments")
          .update({
            cemetery_name: cemeteryName,
            monument_type: monumentType,
            material,
            estimated_miles: Number(estimatedMiles),
            section: section || null,
            lot_number: lotNumber || null,
            approximate_height: approximateHeight || null,
            condition_moss_algae: condMoss,
            condition_chipping: condChipping,
            condition_leaning: condLeaning,
            condition_faded_inscription: condFaded,
            condition_not_cleaned: condNotCleaned,
            known_damage: knownDamage,
          })
          .eq("id", monumentId);
        if (monErr) throw monErr;
      }

      // Update customer profile
      const { error: profErr } = await supabase
        .from("profiles")
        .update({
          full_name: custName || null,
          email: custEmail || null,
          phone: custPhone || null,
          address: custAddress || null,
          city: custCity || null,
          state: custState || null,
          zip: custZip || null,
        })
        .eq("user_id", order!.user_id);
      if (profErr) throw profErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-order-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-orders"] });
      toast({ title: "All changes saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return <p className="text-muted-foreground">Order not found.</p>;
  }

  const toggleAddOn = (addonId: string) => {
    setAddOns((prev) =>
      prev.includes(addonId) ? prev.filter((a) => a !== addonId) : [...prev, addonId]
    );
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/orders")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-display font-bold">View / Change Order</h1>
            {(order as any).is_gift && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/15 text-accent">
                <Gift className="w-3.5 h-3.5" /> Gift Order
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">#{order.id.slice(0, 8)}</p>
        </div>
        <Button
          className="ml-auto gap-2"
          onClick={() => saveAll.mutate()}
          disabled={saveAll.isPending}
        >
          {saveAll.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save All Changes
        </Button>
      </div>

      {/* ORDER DETAILS */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg">Order Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={handleStatusChange}>
              <SelectTrigger className="h-9 text-sm capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-sm capitalize">{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Scheduled Date</Label>
            <Input
              type="date"
              value={scheduledDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Base Price</Label>
            <Input type="number" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Travel Fee</Label>
            <Input type="number" value={travelFee} onChange={(e) => setTravelFee(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Add-ons Total</Label>
            <Input type="number" value={addOnsTotal} onChange={(e) => setAddOnsTotal(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bundle Price</Label>
            <Input type="number" value={bundlePrice} onChange={(e) => setBundlePrice(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total Price</Label>
            <Input type="number" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} className="h-9 text-sm font-semibold" />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Checkbox checked={isVeteran} onCheckedChange={(c) => setIsVeteran(!!c)} id="veteran" />
            <Label htmlFor="veteran" className="text-xs">Veteran Discount</Label>
          </div>
        </div>

        {/* Annual Plan selection */}
        <div className="space-y-1.5">
          <Label className="text-xs">Annual Plan</Label>
          <Select value={bundleId || "none"} onValueChange={(v) => setBundleId(v === "none" ? "" : v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No plan</SelectItem>
              {Object.entries(MAINTENANCE_PLANS).map(([key, plan]) => (
                <SelectItem key={key} value={key}>{plan.label}</SelectItem>
              ))}
              {Object.entries(FLOWER_PLANS).map(([key, plan]) => (
                <SelectItem key={key} value={key}>{plan.label}</SelectItem>
              ))}
              {FLOWER_ONLY_PLANS.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.label} (${b.price})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Add-ons */}
        <div className="space-y-2">
          <Label className="text-xs">Add-ons</Label>
          <div className="grid grid-cols-2 gap-2">
            {ADD_ONS.map((addon) => (
              <div key={addon.id} className="flex items-center gap-2">
                <Checkbox
                  checked={addOns.includes(addon.id)}
                  onCheckedChange={() => toggleAddOn(addon.id)}
                  id={`addon-${addon.id}`}
                />
                <Label htmlFor={`addon-${addon.id}`} className="text-xs">
                  {addon.label} {addon.price > 0 ? `($${addon.price})` : ""}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Admin Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm min-h-[60px]" placeholder="Internal notes…" />
        </div>

        {order.stripe_payment_status && (
          <p className="text-xs text-muted-foreground">
            Stripe Payment: <span className="font-medium">{order.stripe_payment_status}</span>
          </p>
        )}
      </section>

      {/* SCHEDULE OPTIMIZER — pair flower placements with cleanings, allow manual reassignment */}
      {optimizerSlots.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-display font-semibold text-lg flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Schedule Optimizer
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plan: {subscription?.plan ?? "—"} · Each placement is anchored; the cleaning on that day is bundled as one trip.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {scheduleApproved ? (
                <>
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600 font-medium">
                    <Check className="w-3 h-3" /> Approved{approvedAt ? ` · ${format(new Date(approvedAt), "MMM d")}` : ""}
                  </span>
                  <Button variant="outline" size="sm" className="text-xs" onClick={unlockSchedule}>
                    Unlock & Edit
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => approveSchedule.mutate()}
                  disabled={approveSchedule.isPending}
                >
                  {approveSchedule.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Approve Schedule
                </Button>
              )}
            </div>
          </div>

          {clusterWarning && clusterWarning.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-xs text-destructive space-y-1">
                <p className="font-semibold">Clustering warning — placements grouped within 60 days. Cleanings may be unevenly distributed.</p>
                {clusterWarning.map((p, i) => (
                  <p key={i}>
                    {format(p.a, "MMM d, yyyy")} → {format(p.b, "MMM d, yyyy")} ({p.days} days apart)
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {optimizerSlots.map((s) => {
              const hasFlower = !!s.placementDate;
              const trip = s.paired && hasFlower ? "Clean + Place" : hasFlower ? "Placement + Cleaning (separate trip)" : "Cleaning";
              return (
                <div
                  key={s.key}
                  className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                      {s.paired && hasFlower ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                          <Flower2 className="w-3 h-3" /> Clean + Place
                        </span>
                      ) : hasFlower ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/20 text-accent">
                          <Flower2 className="w-3 h-3" /> Placement
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          <Sparkles className="w-3 h-3" /> Cleaning
                        </span>
                      )}
                      <span className="text-muted-foreground font-normal">{trip}</span>
                    </span>
                    {hasFlower && !scheduleApproved && (
                      <label className="text-xs flex items-center gap-1.5 text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={s.paired}
                          onCheckedChange={(c) => updateSlot(s.key, { paired: !!c })}
                        />
                        Pair as single trip
                      </label>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {hasFlower && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Placement Date (anchor)</Label>
                        <Input
                          type="date"
                          value={s.placementDate ?? ""}
                          disabled={scheduleApproved}
                          onChange={(e) => updateSlot(s.key, { placementDate: e.target.value || null })}
                          className="h-8 text-sm"
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Cleaning Date</Label>
                      <Input
                        type="date"
                        value={s.cleaningDate}
                        disabled={scheduleApproved}
                        onChange={(e) => updateSlot(s.key, { cleaningDate: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* MONUMENT DETAILS */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg">Monument Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs">Cemetery Name</Label>
            <Input value={cemeteryName} onChange={(e) => setCemeteryName(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Monument Type</Label>
            <Select value={monumentType} onValueChange={(v) => setMonumentType(v as MonumentType)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-sm">
                    {MONUMENT_PRICES[t]?.label ?? t.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Material</Label>
            <Select value={material} onValueChange={(v) => setMaterial(v as MaterialType)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MATERIALS.map((m) => (
                  <SelectItem key={m} value={m} className="text-sm capitalize">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Estimated Miles</Label>
            <Input type="number" value={estimatedMiles} onChange={(e) => setEstimatedMiles(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Section</Label>
            <Input value={section} onChange={(e) => setSection(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Lot Number</Label>
            <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Approx Height</Label>
            <Input value={approximateHeight} onChange={(e) => setApproximateHeight(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <Label className="text-xs">Conditions</Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { label: "Moss / Algae", checked: condMoss, set: setCondMoss },
              { label: "Chipping", checked: condChipping, set: setCondChipping },
              { label: "Leaning", checked: condLeaning, set: setCondLeaning },
              { label: "Faded Inscription", checked: condFaded, set: setCondFaded },
              { label: "Not Cleaned Recently", checked: condNotCleaned, set: setCondNotCleaned },
              { label: "Known Damage", checked: knownDamage, set: setKnownDamage },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-2">
                <Checkbox checked={c.checked} onCheckedChange={(v) => c.set(!!v)} />
                <span className="text-xs">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CUSTOMER INFO */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg">Customer Info</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Full Name</Label>
            <Input value={custName} onChange={(e) => setCustName(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input value={custEmail} onChange={(e) => setCustEmail(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Phone</Label>
            <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Address</Label>
            <Input value={custAddress} onChange={(e) => setCustAddress(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">City</Label>
            <Input value={custCity} onChange={(e) => setCustCity(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">State</Label>
            <Input value={custState} onChange={(e) => setCustState(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Zip</Label>
            <Input value={custZip} onChange={(e) => setCustZip(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
      </section>

      {/* GIFT ORDER INFO */}
      {(order as any).is_gift && (
        <section className="rounded-xl border border-accent/30 bg-accent/5 p-5 space-y-4">
          <h2 className="font-display font-semibold text-lg flex items-center gap-2">
            <Gift className="w-5 h-5 text-accent" /> Gift Order Details
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Buyer (Paid By)</Label>
              <p className="text-sm font-medium">{order.shopper_name || '—'}</p>
              <p className="text-xs text-muted-foreground">{order.shopper_email || ''}</p>
              <p className="text-xs text-muted-foreground">{order.shopper_phone || ''}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Gift Recipient</Label>
              <p className="text-sm font-medium">{(order as any).gift_recipient_name || '—'}</p>
              <p className="text-xs text-muted-foreground">{(order as any).gift_recipient_email || ''}</p>
              <p className="text-xs text-muted-foreground">{(order as any).gift_recipient_phone || ''}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Deceased</Label>
              <p className="text-sm font-medium">{order.deceased_name || '—'}</p>
            </div>
          </div>
          {(order as any).gift_message && (
            <div className="space-y-1.5 border-t border-accent/20 pt-3">
              <Label className="text-xs">Gift Message</Label>
              <p className="text-sm italic text-muted-foreground">"{(order as any).gift_message}"</p>
            </div>
          )}
        </section>
      )}

      {/* BEFORE PHOTOS (Customer) */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg">Before Photos</h2>
        <p className="text-xs text-muted-foreground">Photos provided by the customer during intake</p>
        <CustomerPhotosGallery monumentId={(order.monuments as any)?.id || order.monument_id} />
      </section>

      {/* FINISHED PHOTOS (Technician) */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg">Finished Photos</h2>
        <p className="text-xs text-muted-foreground">Photos uploaded by the technician after service</p>
        <PhotoUpload
          monumentId={(order.monuments as any)?.id || order.monument_id}
          orderId={order.id}
          userId={order.user_id}
        />
      </section>

      {/* SERVICE LOG */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg">Add Service Log</h2>
        <ServiceLogForm
          monumentId={(order.monuments as any)?.id || order.monument_id}
          orderId={order.id}
          userId={order.user_id}
        />
        <AdminServiceLogsList monumentId={(order.monuments as any)?.id || order.monument_id} />
      </section>
    </div>
  );
};

function CustomerPhotosGallery({ monumentId }: { monumentId: string }) {
  const { data: photos } = useQuery({
    queryKey: ["customer-before-photos", monumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photo_records")
        .select("*")
        .eq("monument_id", monumentId)
        .eq("description", "Client upload — intake")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (!photos?.length) {
    return <p className="text-xs text-muted-foreground italic">No customer photos uploaded.</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {photos.map((photo) => (
        <div key={photo.id} className="relative rounded-lg overflow-hidden border border-border">
          <img
            src={photo.photo_url}
            alt="Customer before photo"
            className="w-full aspect-square object-cover"
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
}

function AdminServiceLogsList({ monumentId }: { monumentId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: logs } = useQuery({
    queryKey: ["admin-service-logs", monumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_logs")
        .select("*")
        .eq("monument_id", monumentId)
        .order("service_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const generateShareLink = useMutation({
    mutationFn: async (logId: string) => {
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      const { error } = await supabase
        .from("service_logs")
        .update({ share_token: token } as any)
        .eq("id", logId);
      if (error) throw error;
      return token;
    },
    onSuccess: (token) => {
      queryClient.invalidateQueries({ queryKey: ["admin-service-logs", monumentId] });
      const url = `${window.location.origin}/report/${token}`;
      navigator.clipboard.writeText(url);
      toast({ title: "Share link copied to clipboard" });
    },
    onError: (err: Error) => {
      toast({ title: "Error generating link", description: err.message, variant: "destructive" });
    },
  });

  const copyLink = (token: string, logId: string) => {
    const url = `${window.location.origin}/report/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(logId);
    toast({ title: "Link copied" });
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!logs?.length) return null;

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <h3 className="text-sm font-semibold text-muted-foreground">Previous Service Logs</h3>
      {logs.map((log) => (
        <div key={log.id} className="rounded-lg border border-border/50 bg-secondary/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">{new Date(log.service_date).toLocaleDateString()}</p>
            <div className="flex items-center gap-1.5">
              {log.time_spent_minutes && <p className="text-[10px] text-muted-foreground">{log.time_spent_minutes} min</p>}
              {(log as any).share_token ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2"
                  onClick={() => copyLink((log as any).share_token, log.id)}
                >
                  {copiedId === log.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedId === log.id ? "Copied" : "Copy Link"}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2"
                  onClick={() => generateShareLink.mutate(log.id)}
                  disabled={generateShareLink.isPending}
                >
                  <Share2 className="w-3 h-3" /> Share
                </Button>
              )}
            </div>
          </div>
          {(log.services_performed as string[])?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(log.services_performed as string[]).map((s: string) => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{s}</span>
              ))}
            </div>
          )}
          {log.public_notes && <p className="text-[10px] text-muted-foreground">Public: {log.public_notes}</p>}
          {log.private_notes && <p className="text-[10px] text-accent italic">Private: {log.private_notes}</p>}
        </div>
      ))}
    </div>
  );
}

export default AdminOrderDetail;
