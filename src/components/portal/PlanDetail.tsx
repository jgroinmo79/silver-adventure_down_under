import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MAINTENANCE_PLANS } from "@/lib/pricing";
import { Shield, Calendar, CheckCircle, PauseCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface PlanDetailProps {
  subscription: any;
}

const PlanDetail = ({ subscription }: PlanDetailProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestType, setRequestType] = useState<"pause" | "cancel">("pause");
  const [reason, setReason] = useState("");

  const plan = MAINTENANCE_PLANS[subscription.plan as keyof typeof MAINTENANCE_PLANS];

  // Check for existing pause/cancel request
  const { data: existingRequest } = useQuery({
    queryKey: ["plan-change-request", subscription.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("user_id", user?.id ?? "")
        .in("category", ["pause_plan", "cancel_plan"])
        .in("status", ["received", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const submitRequest = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("support_tickets").insert({
        user_id: user?.id ?? "",
        monument_id: subscription.monument_id,
        category: requestType === "pause" ? "pause_plan" : "cancel_plan",
        subject: `Request to ${requestType} ${plan?.label ?? subscription.plan} plan`,
        description: reason || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Request submitted", description: "We'll get back to you shortly." });
      setShowRequestForm(false);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["plan-change-request", subscription.id] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Calculate scheduled visit dates based on plan
  const getScheduledVisits = () => {
    const start = new Date(subscription.start_date);
    const year = start.getFullYear();
    const visits: { label: string; date: string }[] = [];

    if (subscription.plan === "keeper") {
      visits.push({ label: "Spring cleaning", date: `${year}-04-15` });
      visits.push({ label: "Fall cleaning", date: `${year}-10-15` });
    } else if (subscription.plan === "sentinel") {
      visits.push({ label: "Spring cleaning", date: `${year}-04-15` });
      visits.push({ label: "Summer cleaning", date: `${year}-07-15` });
      visits.push({ label: "Fall cleaning", date: `${year}-10-15` });
    } else if (subscription.plan === "legacy") {
      visits.push({ label: "Spring cleaning", date: `${year}-04-15` });
      visits.push({ label: "Summer cleaning", date: `${year}-07-15` });
      visits.push({ label: "Fall cleaning", date: `${year}-10-15` });
      visits.push({ label: "Flower placements (5)", date: "Custom dates" });
    }
    return visits;
  };

  const visits = getScheduledVisits();

  const statusIcon = {
    active: <CheckCircle className="w-4 h-4 text-primary" />,
    paused: <PauseCircle className="w-4 h-4 text-accent" />,
    cancelled: <XCircle className="w-4 h-4 text-destructive" />,
    expired: <XCircle className="w-4 h-4 text-muted-foreground" />,
  };

  const planStatusColors: Record<string, string> = {
    active: "bg-primary/20 text-primary",
    paused: "bg-accent/20 text-accent",
    cancelled: "bg-destructive/20 text-destructive",
    expired: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-5">
      {/* Plan header */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-display font-bold text-lg capitalize">{plan?.label ?? subscription.plan}</h3>
              <p className="text-xs text-muted-foreground">{subscription.monuments?.cemetery_name}</p>
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${planStatusColors[subscription.status]}`}>
            {statusIcon[subscription.status as keyof typeof statusIcon]}
            {subscription.status}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Price</p>
            <p className="font-bold">${Number(subscription.price).toFixed(0)}/{subscription.period}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Since</p>
            <p className="font-medium">{new Date(subscription.start_date).toLocaleDateString()}</p>
          </div>
          {subscription.end_date && (
            <div>
              <p className="text-xs text-muted-foreground">Until</p>
              <p className="font-medium">{new Date(subscription.end_date).toLocaleDateString()}</p>
            </div>
          )}
        </div>

        {subscription.important_dates && (
          <div className="text-sm">
            <p className="text-xs text-muted-foreground">Important Dates</p>
            <p className="font-medium">{subscription.important_dates}</p>
          </div>
        )}
      </div>

      {/* What's included */}
      {plan && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h4 className="font-display font-semibold text-sm">What's Included</h4>
          <p className="text-xs text-muted-foreground">{plan.description}</p>
        </div>
      )}

      {/* Scheduled visits */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h4 className="font-display font-semibold text-sm flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" /> Scheduled Visits
        </h4>
        <div className="space-y-2">
          {visits.map((v, i) => (
            <div key={i} className="flex items-center justify-between text-sm rounded-lg bg-secondary/50 px-3 py-2">
              <span className="font-medium">{v.label}</span>
              <span className="text-xs text-muted-foreground">
                {v.date === "Custom dates" ? v.date : new Date(v.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Pause/Cancel request */}
      {subscription.status === "active" && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          {existingRequest ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pending Request</p>
              <p className="text-xs text-muted-foreground">
                You've submitted a {existingRequest.category === "pause_plan" ? "pause" : "cancellation"} request.
                Status: <span className="font-medium capitalize">{existingRequest.status}</span>
              </p>
              {existingRequest.admin_response && (
                <p className="text-xs bg-secondary/50 rounded-lg px-3 py-2">{existingRequest.admin_response}</p>
              )}
            </div>
          ) : showRequestForm ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={requestType === "pause" ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setRequestType("pause")}
                >
                  <PauseCircle className="w-3 h-3 mr-1" /> Pause Plan
                </Button>
                <Button
                  variant={requestType === "cancel" ? "destructive" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setRequestType("cancel")}
                >
                  <XCircle className="w-3 h-3 mr-1" /> Cancel Plan
                </Button>
              </div>
              <Textarea
                placeholder="Reason (optional)..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="text-sm min-h-[60px]"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => submitRequest.mutate()} disabled={submitRequest.isPending}>
                  {submitRequest.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  Submit Request
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowRequestForm(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowRequestForm(true)}>
              Request Pause or Cancellation
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default PlanDetail;
