import { useState, useMemo, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import logo from "@/assets/logo-bronze.png";
import BookingProgress from "./BookingProgress";
import CemeteryStep from "@/components/steps/CemeteryStep";
import ContactStep from "@/components/steps/ContactStep";
import MonumentStep from "@/components/steps/MonumentStep";
import ConditionStep from "@/components/steps/ConditionStep";
import IntentStep from "@/components/steps/IntentStep";
import ServiceStep from "@/components/steps/ServiceStep";
import AddOnsStep from "@/components/steps/AddOnsStep";
import HolidayPickerStep from "@/components/steps/HolidayPickerStep";

import FlowerArrangementStep from "@/components/steps/FlowerArrangementStep";
import FlowerSlotWizardStep from "@/components/steps/FlowerSlotWizardStep";
import CleaningFlowerAddonStep from "@/components/steps/CleaningFlowerAddonStep";
import IntentLandingStep from "@/components/steps/IntentLandingStep";
import ScheduleDateStep from "@/components/steps/ScheduleDateStep";
import ConsentStep from "@/components/steps/ConsentStep";
import CheckoutStep from "@/components/steps/CheckoutStep";
import { IntakeFormData, initialFormData, FLOWER_PLANS, FLOWER_ONLY_PLANS } from "@/lib/pricing";
import { supabase } from "@/integrations/supabase/client";
import { getSessionId } from "@/components/PageViewTracker";

const getLeadClient = (sessionId: string) =>
  createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { global: { headers: { "x-session-id": sessionId } } }
  );

type StepDef = {
  id: string;
  render: (data: IntakeFormData, update: (d: Partial<IntakeFormData>) => void) => React.ReactNode;
  canProceed: (data: IntakeFormData) => boolean;
};

const BookingFlow = () => {
  const [stepIndex, setStepIndex] = useState(0);
  const [data, setData] = useState<IntakeFormData>(initialFormData);
  const leadIdRef = useRef<string | null>(null);
  const totalStepsRef = useRef(0);

  const advanceStep = () => {
    setStepIndex((prev) => {
      const next = Math.min((totalStepsRef.current || prev + 2) - 1, prev + 1);
      window.history.pushState({ step: next }, "");
      window.scrollTo({ top: 0, behavior: "instant" });
      return next;
    });
  };

  const update = (partial: Partial<IntakeFormData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  };

  const intent = data.intent;
  const isFlowerOnly = intent === 'flowers';
  const needsFlowerDates = intent === 'flowers' || intent === 'both';

  // Number of flower slots based on chosen plan (matches new ServiceStep semantics)
  const flowerPickLimit = (() => {
    if (intent === 'both' && data.selectedFlowerPlan) {
      const plan = FLOWER_PLANS[data.selectedFlowerPlan as keyof typeof FLOWER_PLANS];
      return plan ? plan.flowers : 0;
    }
    if (intent === 'flowers' && data.selectedFlowerOnly) {
      const entry = FLOWER_ONLY_PLANS.find((f) => f.id === data.selectedFlowerOnly);
      return entry ? entry.placements : 0;
    }
    return 0;
  })();

  const steps: StepDef[] = useMemo(() => {
    const base: StepDef[] = [
      {
        id: 'intent-landing',
        render: (d, u) => <IntentLandingStep data={d} update={u} />,
        canProceed: (d) => d.intent !== '',
      },
      {
        id: 'cemetery',
        render: (d, u) => <CemeteryStep data={d} update={u} />,
        canProceed: (d) => d.cemeteryName.trim().length > 0,
      },
      {
        id: 'contact',
        render: (d, u) => <ContactStep data={d} update={u} />,
        canProceed: (d) => d.shopperName.trim().length > 0 && d.shopperEmail.trim().length > 0 && d.shopperRelationship.trim().length > 0,
      },
    ];

    // Monument-detail + condition steps only when monument care is involved
    if (!isFlowerOnly) {
      base.push(
        {
          id: 'monument',
          render: (d, u) => <MonumentStep data={d} update={u} />,
          canProceed: (d) => {
            if (d.isVeteran) return d.veteranMonumentType !== '' && d.veteranMaterial !== '';
            return d.monumentType !== '' && d.material !== '';
          },
        },
        {
          id: 'condition',
          render: (d, u) => <ConditionStep data={d} update={u} />,
          canProceed: () => true,
        },
      );
    }

    base.push(
      {
        id: 'service',
        render: (d, u) => <ServiceStep data={d} update={u} />,
        canProceed: (d) => d.selectedOffer !== '' || d.selectedMaintenancePlan !== '' || d.selectedFlowerPlan !== '' || d.selectedFlowerOnly !== '',
      },
    );

    // Optional flower add-on step for cleaning flows (one-time or annual maintenance).
    // Skipped entirely for flower-only intent and the legacy combined "flower plan".
    const hasCleaningSelection =
      !isFlowerOnly &&
      !data.selectedFlowerPlan &&
      (data.selectedOffer === 'cleaning' || !!data.selectedMaintenancePlan);
    if (hasCleaningSelection) {
      base.push({
        id: 'cleaning-flower-addon',
        render: (d, u) => <CleaningFlowerAddonStep data={d} update={u} />,
        // Always skippable — empty array is a valid "no thanks" answer.
        canProceed: () => true,
      });
    }

    base.push(
      {
        id: 'intent',
        render: (d, u) => <IntentStep data={d} update={u} />,
        canProceed: () => true,
      },
      {
        id: 'addons',
        render: (d, u) => <AddOnsStep data={d} update={u} />,
        canProceed: () => true,
      },
    );

    // Per-slot flower wizard (replaces holiday + arrangement steps)
    if (needsFlowerDates && flowerPickLimit > 0) {
      base.push({
        id: 'flower-slots',
        render: (d, u) => <FlowerSlotWizardStep data={d} update={u} totalSlots={flowerPickLimit} onComplete={advanceStep} />,
        canProceed: (d) => {
          const slots = d.flowerSlotKeys.slice(0, flowerPickLimit);
          if (slots.length !== flowerPickLimit) return false;
          return slots.every((k) => k && !!d.selectedArrangements[k]);
        },
      });
    }

    base.push({
      id: 'schedule',
      render: (d, u) => <ScheduleDateStep data={d} update={u} />,
      canProceed: () => true,
    });

    // Consent only applies when biological cleaning is happening
    if (!isFlowerOnly) {
      base.push({
        id: 'consent',
        render: (d, u) => <ConsentStep data={d} update={u} />,
        canProceed: (d) => d.consentBiological && d.consentAuthorize,
      });
    }

    base.push({
      id: 'checkout',
      render: (d) => <CheckoutStep data={d} />,
      canProceed: () => true,
    });

    return base;
  }, [intent, isFlowerOnly, needsFlowerDates, flowerPickLimit, data.selectedOffer, data.selectedMaintenancePlan, data.selectedFlowerPlan]);

  // Track abandoned lead on step changes
  useEffect(() => {
    const sessionId = getSessionId();
    const leadClient = getLeadClient(sessionId);
    const saveProgress = async () => {
      const stepId = steps[Math.min(stepIndex, steps.length - 1)]?.id || "cemetery";
      const leadData: any = {
        session_id: sessionId,
        step_reached: stepId,
        step_index: stepIndex,
        email: data.shopperEmail || null,
        name: data.shopperName || null,
        phone: data.shopperPhone || null,
        form_data: {
          intent: data.intent,
          cemeteryName: data.cemeteryName,
          monumentType: data.monumentType,
          selectedOffer: data.selectedOffer,
          selectedMaintenancePlan: data.selectedMaintenancePlan,
          selectedFlowerPlan: data.selectedFlowerPlan,
          selectedFlowerOnly: data.selectedFlowerOnly,
        },
      };

      if (!leadIdRef.current) {
        const { data: inserted } = await leadClient
          .from("abandoned_leads")
          .insert(leadData)
          .select("id")
          .single();
        if (inserted) leadIdRef.current = (inserted as any).id;
      } else {
        await leadClient
          .from("abandoned_leads")
          .update(leadData)
          .eq("id", leadIdRef.current);
      }
    };

    const timer = setTimeout(saveProgress, 1500);
    return () => clearTimeout(timer);
  }, [stepIndex, data.shopperEmail, data.shopperName, data.shopperPhone, data.cemeteryName, steps]);

  const totalSteps = steps.length;
  totalStepsRef.current = totalSteps;
  const safeIndex = totalSteps > 0 ? Math.min(stepIndex, totalSteps - 1) : 0;
  const currentStep = totalSteps > 0 ? steps[safeIndex] : undefined;

  useEffect(() => {
    if (totalSteps > 0 && stepIndex !== safeIndex) {
      setStepIndex(safeIndex);
    }
  }, [stepIndex, safeIndex, totalSteps]);

  const goToStep = (s: number, pushHistory = true) => {
    setStepIndex(s);
    if (pushHistory) {
      window.history.pushState({ step: s }, "");
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  useEffect(() => {
    window.history.replaceState({ step: 0 }, "");
  }, []);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state && typeof e.state.step === "number") {
        setStepIndex(e.state.step);
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <div className="min-h-screen gradient-dark">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="text-center mb-2">
          <img src={logo} alt="Grave Detail Cleaning & Preservation" className="h-12 mx-auto mb-1" />
        </div>

        <BookingProgress currentStep={safeIndex} totalSteps={totalSteps} />

        {!currentStep ? null : <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="mt-6"
          >
            {currentStep.render(data, update)}
          </motion.div>
        </AnimatePresence>}

        {currentStep && <div className="flex justify-between mt-10 max-w-md mx-auto">
          <Button
            variant="outline"
            onClick={() => goToStep(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>

          {safeIndex < totalSteps - 1 && (
            <Button
              className="bg-[#7A5C3E] hover:bg-[#C9976B] text-white"
              onClick={() => goToStep(Math.min(totalSteps - 1, safeIndex + 1))}
              disabled={!currentStep.canProceed(data)}
            >
              Continue <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>}
      </div>
    </div>
  );
};

export default BookingFlow;
