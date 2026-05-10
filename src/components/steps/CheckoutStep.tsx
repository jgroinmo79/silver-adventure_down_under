import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IntakeFormData, MONUMENT_PRICES, ADD_ONS, MAINTENANCE_PLANS, MAINTENANCE_PLAN_PRICES, FLOWER_PLANS, FLOWER_PLAN_PRICES, FLOWER_ONLY_PLANS, MonumentType } from "@/lib/pricing";
import { useTravelZones, resolveTravelFee, isAnnualPlanFreeTravel } from "@/hooks/useTravelZones";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CreditCard, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TERMS_CONSENT_TEXT = "I have read and agree to the Terms of Service, Liability Waiver, and Cancellation Policy. I understand that Grave Detail is not responsible for pre-existing damage, deterioration, or fragility of any monument, and that all services are performed at the owner's discretion. Photo documentation may be taken for quality assurance and portfolio purposes.";
const TERMS_VERSION = "1.0";

interface Props {
  data: IntakeFormData;
}

const CheckoutStep = ({ data }: Props) => {
  const [loading, setLoading] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);

  const VETERAN_TO_BASE: Record<string, MonumentType> = {
    va_upright: 'single_upright',
    va_flat: 'single_marker',
    va_niche: 'single_marker',
  };
  const resolvedType: MonumentType | '' = data.isVeteran
    ? (data.veteranMonumentType ? (VETERAN_TO_BASE[data.veteranMonumentType] ?? '') : '')
    : (data.monumentType as MonumentType | '');
  const monument = resolvedType ? MONUMENT_PRICES[resolvedType] : null;
  const { data: zoneConfig } = useTravelZones();
  const hasAnnualPlan = !!data.selectedMaintenancePlan;
  const travelZone = zoneConfig
    ? resolveTravelFee(data.estimatedMiles, zoneConfig.zones, zoneConfig.settings, hasAnnualPlan)
    : { label: "", fee: 0, fee_label: "" };
  const travelFee = travelZone.fee;
  const showFreeTravelCallout = zoneConfig
    ? isAnnualPlanFreeTravel(data.estimatedMiles, zoneConfig.settings, hasAnnualPlan)
    : false;
  const standardZoneFee = (() => {
    if (!zoneConfig || !showFreeTravelCallout) return 0;
    const sorted = [...zoneConfig.zones].sort((a, b) => a.max_miles - b.max_miles);
    return (sorted.find((z) => data.estimatedMiles <= z.max_miles)?.fee) ?? 0;
  })();

  // Plan lookups
  const maintenancePlan = data.selectedMaintenancePlan ? MAINTENANCE_PLANS[data.selectedMaintenancePlan as keyof typeof MAINTENANCE_PLANS] : null;
  const maintenancePrice = (resolvedType && data.selectedMaintenancePlan) ? (MAINTENANCE_PLAN_PRICES[resolvedType]?.[data.selectedMaintenancePlan] ?? 0) : 0;
  const flowerPlan = data.selectedFlowerPlan ? FLOWER_PLANS[data.selectedFlowerPlan as keyof typeof FLOWER_PLANS] : null;
  const flowerPlanPrice = (resolvedType && data.selectedFlowerPlan) ? (FLOWER_PLAN_PRICES[resolvedType]?.[data.selectedFlowerPlan] ?? 0) : 0;
  const flowerOnly = FLOWER_ONLY_PLANS.find((f) => f.id === data.selectedFlowerOnly);

  const showCleaningLine = !data.selectedMaintenancePlan && !data.selectedFlowerPlan;
  const basePrice = (showCleaningLine && monument) ? monument.price : 0;

  const selectedAddOns = ADD_ONS.filter((a) => data.addOns.includes(a.id));
  const addOnTotal = selectedAddOns.reduce((sum, a) => sum + a.price, 0);

  const planPrice = maintenancePrice + flowerPlanPrice + (flowerOnly?.price ?? 0);
  const FLOWER_ADDON_PRICE = 50;
  const cleaningFlowerAddons = data.cleaningFlowerAddons ?? [];
  const cleaningFlowerAddonTotal = cleaningFlowerAddons.length * FLOWER_ADDON_PRICE;
  let subtotal = basePrice + planPrice + travelFee + addOnTotal + cleaningFlowerAddonTotal;
  if (data.isVeteran) subtotal = Math.round(subtotal * 0.9);

  // Check if we have flower placements to display
  const hasFlowerPlacements = (flowerPlan || flowerOnly) && data.selectedHolidays.length > 0;
  const arrangementIds = Array.from(new Set([
    ...Object.values(data.selectedArrangements).filter(Boolean),
    ...cleaningFlowerAddons.map((a) => a.arrangementId).filter(Boolean),
  ]));

  // Fetch arrangement names for display
  const { data: arrangements = [] } = useQuery({
    queryKey: ["checkout-arrangements", arrangementIds],
    queryFn: async () => {
      if (arrangementIds.length === 0) return [];
      const { data: rows, error } = await supabase
        .from("flower_arrangements")
        .select("id, name")
        .in("id", arrangementIds);
      if (error) throw error;
      return rows;
    },
    enabled: arrangementIds.length > 0,
  });

  const getArrangementName = (id: string) => {
    const found = arrangements.find((a: any) => a.id === id);
    return found ? found.name : "Selected arrangement";
  };

  const needsCustomDate = (holiday: string) =>
    holiday === "Deceased's Birthday" || holiday === "Deceased's Anniversary";

  const getHolidayLabel = (holiday: string) => {
    if (needsCustomDate(holiday) && data.holidayCustomDates[holiday]) {
      return `${holiday} — ${data.holidayCustomDates[holiday]}`;
    }
    return holiday;
  };

  // Plan descriptions
  const getMaintenanceDescription = () => {
    if (!maintenancePlan) return '';
    return `${maintenancePlan.visits} cleanings per year · Endurance product · Photos after each visit · Priority scheduling`;
  };

  const getFlowerPlanDescription = () => {
    if (!flowerPlan) return '';
    return `${flowerPlan.cleanings} cleanings + ${flowerPlan.flowers} flower placements per year · Photos after each visit · Priority scheduling`;
  };

  const getFlowerOnlyDescription = () => {
    if (!flowerOnly) return '';
    return `${flowerOnly.placements} flower placement${flowerOnly.placements > 1 ? 's' : ''} per year · Travel fee applies`;
  };

  const handleCheckout = async () => {
    if (!agreedTerms) {
      toast.error("Please agree to the Terms of Service to continue.");
      return;
    }
    setLoading(true);
    try {
      // Log consent agreement
      try {
        const { data: authData } = await supabase.auth.getUser();
        await supabase.from("consent_logs").insert({
          user_id: authData?.user?.id ?? null,
          booking_id: null,
          terms_version: TERMS_VERSION,
          consent_text: TERMS_CONSENT_TEXT,
          agreed_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.error("Failed to log consent:", logErr);
      }

      const { data: result, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          monumentType: data.monumentType,
          veteranMonumentType: data.veteranMonumentType || null,
          selectedOffer: data.selectedOffer,
          estimatedMiles: data.estimatedMiles,
          addOns: data.addOns,
          selectedMaintenancePlan: data.selectedMaintenancePlan || null,
          selectedFlowerPlan: data.selectedFlowerPlan || null,
          selectedFlowerOnly: data.selectedFlowerOnly || null,
          selectedArrangements: data.selectedArrangements,
          isVeteran: data.isVeteran,
          customerEmail: data.shopperEmail,
          cemeteryName: data.cemeteryName,
          cemeteryLat: data.cemeteryLat,
          cemeteryLng: data.cemeteryLng,
          section: data.section,
          lotNumber: data.lotNumber,
          material: data.material,
          approximateHeight: data.approximateHeight,
          knownDamage: data.knownDamage,
          conditions: data.conditions,
          deceasedName: data.deceasedName,
          shopperName: data.shopperName,
          shopperPhone: data.shopperPhone,
          shopperEmail: data.shopperEmail,
          photos: data.photos,
          consentBiological: data.consentBiological,
          consentAuthorize: data.consentAuthorize,
          consentPhotos: data.consentPhotos,
          preferredDate: data.preferredDate ? data.preferredDate.toISOString().split('T')[0] : null,
          selectedHolidays: data.selectedHolidays || [],
          holidayCustomDates: data.holidayCustomDates || {},
          isGift: data.isGift || false,
          giftRecipientName: data.giftRecipientName || null,
          giftRecipientEmail: data.giftRecipientEmail || null,
          giftRecipientPhone: data.giftRecipientPhone || null,
          giftMessage: data.giftMessage || null,
          cleaningFlowerAddons: cleaningFlowerAddons,
        },
      });

      if (error) throw error;
      if (result?.url) {
        // Open in a new tab — Stripe Checkout refuses to render inside iframes
        // (e.g. the Lovable preview), which causes the blank skeleton screen.
        const win = window.open(result.url, "_blank");
        if (!win) {
          // Popup blocked — fall back to top-level navigation
          if (window.top) {
            window.top.location.href = result.url;
          } else {
            window.location.href = result.url;
          }
        }
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      console.error("Checkout error:", err);
      toast.error(err.message || "Failed to start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center mb-8">
        <CreditCard className="w-8 h-8 text-primary mx-auto mb-3" />
        <h2 className="text-3xl font-display font-bold mb-2">Review & Checkout</h2>
        <p className="text-muted-foreground">Review your order before payment</p>
      </div>

      <div className="max-w-md mx-auto">
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          {basePrice > 0 && monument && (
            <div>
              <div className="flex justify-between text-sm">
                <span>{monument.label} — Cleaning</span>
                <span className="font-semibold">${basePrice}</span>
              </div>
              <p className="text-xs mt-1 text-muted-foreground">
                Endurance Gravestone &amp; Monument Cleaner treatment · Growth inhibitor · Plot edging · 4 photos delivered same day
              </p>
            </div>
          )}

          {maintenancePlan && (
            <div>
              <div className="flex justify-between text-sm">
                <span>{maintenancePlan.label} (annual plan)</span>
                <span className="font-semibold">${maintenancePrice}/yr</span>
              </div>
              <p className="text-xs mt-1 text-muted-foreground">{getMaintenanceDescription()}</p>
            </div>
          )}

          {flowerPlan && (
            <div>
              <div className="flex justify-between text-sm">
                <span>{flowerPlan.label} (annual plan)</span>
                <span className="font-semibold">${flowerPlanPrice}/yr</span>
              </div>
              <p className="text-xs mt-1 text-muted-foreground">{getFlowerPlanDescription()}</p>
            </div>
          )}

          {flowerOnly && (
            <div>
              <div className="flex justify-between text-sm">
                <span>{flowerOnly.label}</span>
                <span className="font-semibold">${flowerOnly.price}/yr</span>
              </div>
              <p className="text-xs mt-1 text-muted-foreground">{getFlowerOnlyDescription()}</p>
            </div>
          )}

          {/* Per-placement arrangement details */}
          {hasFlowerPlacements && data.selectedHolidays.length > 0 && (
            <div className="border-t border-border/50 pt-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Flower Placements</p>
              {data.selectedHolidays.map((holiday) => {
                const arrangementId = data.selectedArrangements[holiday];
                return (
                  <div key={holiday} className="flex justify-between text-xs text-muted-foreground">
                    <span>{getHolidayLabel(holiday)}</span>
                    <span className="font-medium text-foreground">
                      {arrangementId ? getArrangementName(arrangementId) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {cleaningFlowerAddons.length > 0 && (
            <div className="border-t border-border/50 pt-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Flower Add-Ons
              </p>
              {cleaningFlowerAddons
                .slice()
                .sort((a, b) => a.visitNumber - b.visitNumber)
                .map((a) => (
                  <div
                    key={a.visitNumber}
                    className="flex justify-between text-xs text-muted-foreground"
                  >
                    <span>
                      Visit {a.visitNumber} — {getArrangementName(a.arrangementId)}
                    </span>
                    <span className="font-medium text-foreground">
                      ${FLOWER_ADDON_PRICE}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {travelFee > 0 && (
            <div className="flex justify-between text-sm">
              <span>Travel Fee ({travelZone.label})</span>
              <span className="font-semibold">${travelFee}</span>
            </div>
          )}

          {showFreeTravelCallout && (
            <div className="flex justify-between items-center text-sm rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
              <span className="text-primary font-semibold">
                ✓ Free travel with annual plan
              </span>
              <span className="text-primary font-semibold line-through opacity-70">
                ${standardZoneFee}
              </span>
            </div>
          )}

          {selectedAddOns.map((a) => (
            <div key={a.id} className="flex justify-between text-sm">
              <span>{a.label}</span>
              <span className="font-semibold">${a.price}</span>
            </div>
          ))}

          {data.isVeteran && (
            <div className="flex justify-between text-sm text-primary">
              <span>Veteran Discount (10% off all services)</span>
              <span className="font-semibold">
                -${Math.round((basePrice + planPrice + travelFee + addOnTotal + cleaningFlowerAddonTotal) * 0.1)}
              </span>
            </div>
          )}

          <div className="border-t border-border pt-3 flex justify-between">
            <span className="font-display font-bold text-lg">Total Due Today</span>
            <span className="font-display font-bold text-2xl text-primary">${subtotal}</span>
          </div>
        </div>

        {(data.shopperName || data.deceasedName) && (
          <div className="mt-4 rounded-lg bg-secondary/50 border border-border p-4 space-y-1 text-sm">
            {data.isGift && (
              <p className="text-accent font-semibold text-xs uppercase tracking-wider mb-2">🎁 Gift Order</p>
            )}
            {data.deceasedName && <p><span className="text-muted-foreground">Memorial for:</span> {data.deceasedName}</p>}
            {data.shopperName && <p><span className="text-muted-foreground">{data.isGift ? 'Gift from:' : 'Ordered by:'}</span> {data.shopperName}</p>}
            {data.shopperPhone && <p><span className="text-muted-foreground">Phone:</span> {data.shopperPhone}</p>}
            {data.shopperEmail && <p><span className="text-muted-foreground">Email:</span> {data.shopperEmail}</p>}
            {data.isGift && data.giftRecipientName && (
              <p><span className="text-muted-foreground">Gift recipient:</span> {data.giftRecipientName}</p>
            )}
            {data.isGift && data.giftMessage && (
              <p className="italic text-muted-foreground border-t border-border/50 pt-2 mt-2">"{data.giftMessage}"</p>
            )}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <div
            className={`flex items-start gap-3 p-4 rounded-lg border transition-all ${
              agreedTerms ? "border-primary/50 bg-primary/5" : "border-border bg-secondary/30"
            }`}
          >
            <Checkbox
              id="terms-consent"
              checked={agreedTerms}
              onCheckedChange={(c) => setAgreedTerms(c === true)}
              className="mt-0.5"
            />
            <Label htmlFor="terms-consent" className="text-sm cursor-pointer leading-relaxed">
              {TERMS_CONSENT_TEXT}
            </Label>
          </div>
          <Button
            variant="hero"
            size="lg"
            className="w-full h-12 text-base"
            onClick={handleCheckout}
            disabled={loading || !data.shopperEmail?.trim() || !agreedTerms}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Lock className="w-4 h-4 mr-2" />
            )}
            {loading ? "Redirecting to Stripe…" : "Proceed to Payment"}
          </Button>
          {!data.shopperEmail?.trim() && (
            <p className="text-xs text-center text-destructive">
              Please go back and enter your email in the Contact Info step.
            </p>
          )}
          <p className="text-xs text-center text-muted-foreground">
            Secure payment powered by Stripe. You'll be redirected to complete checkout.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CheckoutStep;
