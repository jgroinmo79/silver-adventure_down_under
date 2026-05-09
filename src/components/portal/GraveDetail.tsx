import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MapPin, Camera, Clock, FileText, Download, Shield, Share2, Copy, Check } from "lucide-react";
import { MONUMENT_PRICES } from "@/lib/pricing";
import type { MonumentType } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface GraveDetailProps {
  monumentId: string;
}

const GraveDetail = ({ monumentId }: GraveDetailProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { data: monument } = useQuery({
    queryKey: ["monument-detail", monumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monuments")
        .select("*")
        .eq("id", monumentId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: orders } = useQuery({
    queryKey: ["monument-orders", monumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("monument_id", monumentId)
        .eq("user_id", user?.id ?? "")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: photos } = useQuery({
    queryKey: ["monument-photos", monumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photo_records")
        .select("*")
        .eq("monument_id", monumentId)
        .eq("client_visible", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: serviceLogs } = useQuery({
    queryKey: ["monument-service-logs", monumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_logs")
        .select("*")
        .eq("monument_id", monumentId)
        .eq("user_id", user?.id ?? "")
        .order("service_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: subscription } = useQuery({
    queryKey: ["monument-subscription", monumentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("monument_id", monumentId)
        .eq("user_id", user?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  if (!monument) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const conditions = [
    monument.condition_moss_algae && "Moss/Algae",
    monument.condition_chipping && "Chipping",
    monument.condition_leaning && "Leaning",
    monument.condition_faded_inscription && "Faded Inscription",
    monument.condition_not_cleaned && "Not Recently Cleaned",
    monument.known_damage && "Known Damage",
  ].filter(Boolean);

  const statusColors: Record<string, string> = {
    pending: "bg-accent/20 text-accent",
    confirmed: "bg-primary/20 text-primary",
    scheduled: "bg-primary/20 text-primary",
    in_progress: "bg-accent/20 text-accent",
    completed: "bg-primary/20 text-primary",
    cancelled: "bg-destructive/20 text-destructive",
  };

  const planStatusColors: Record<string, string> = {
    active: "bg-primary/20 text-primary",
    paused: "bg-accent/20 text-accent",
    cancelled: "bg-destructive/20 text-destructive",
    expired: "bg-muted text-muted-foreground",
  };

  const monumentLabel = MONUMENT_PRICES[monument.monument_type as MonumentType]?.label ?? monument.monument_type.replace(/_/g, " ");

  // Group photos by order_id for before/after pairing
  const photosByOrder = photos?.reduce((map, p) => {
    const key = p.order_id ?? "unlinked";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
    return map;
  }, new Map<string, typeof photos>()) ?? new Map();

  return (
    <div className="space-y-6">
      {/* Monument Info */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            <h2 className="font-display text-xl font-bold">{monument.cemetery_name}</h2>
          </div>
          {subscription && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planStatusColors[subscription.status]}`}>
              <Shield className="w-3 h-3 inline mr-1" />
              {subscription.plan} · {subscription.status}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="font-medium capitalize">{monumentLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Material</p>
            <p className="font-medium capitalize">{monument.material}</p>
          </div>
          {monument.section && (
            <div>
              <p className="text-xs text-muted-foreground">Section</p>
              <p className="font-medium">{monument.section}</p>
            </div>
          )}
          {monument.lot_number && (
            <div>
              <p className="text-xs text-muted-foreground">Lot</p>
              <p className="font-medium">{monument.lot_number}</p>
            </div>
          )}
        </div>
        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {conditions.map((c) => (
              <span key={c as string} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                {c}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Tabbed sections */}
      <Tabs defaultValue="history" className="space-y-4">
        <TabsList className="bg-secondary w-full grid grid-cols-3">
          <TabsTrigger value="history" className="text-xs gap-1">
            <Clock className="w-3 h-3" /> History
          </TabsTrigger>
          <TabsTrigger value="photos" className="text-xs gap-1">
            <Camera className="w-3 h-3" /> Photos
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-xs gap-1">
            <FileText className="w-3 h-3" /> Orders
          </TabsTrigger>
        </TabsList>

        {/* Service History Timeline */}
        <TabsContent value="history" className="space-y-3">
          {!serviceLogs?.length ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">No service logs yet.</p>
            </div>
          ) : (
            <div className="relative pl-6">
              {/* Timeline line */}
              <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

              {serviceLogs.map((log, i) => (
                <div key={log.id} className="relative pb-6 last:pb-0">
                  {/* Timeline dot */}
                  <div className="absolute -left-4 top-1 w-3 h-3 rounded-full bg-primary border-2 border-card" />

                    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{new Date(log.service_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
                      <div className="flex items-center gap-1.5">
                        {log.time_spent_minutes && (
                          <p className="text-xs text-muted-foreground">{log.time_spent_minutes} min</p>
                        )}
                        {(log as any).share_token && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] gap-1 px-2"
                            onClick={() => {
                              const url = `${window.location.origin}/report/${(log as any).share_token}`;
                              navigator.clipboard.writeText(url);
                              setCopiedId(log.id);
                              toast({ title: "Share link copied — send it to family members" });
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                          >
                            {copiedId === log.id ? <Check className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
                            {copiedId === log.id ? "Copied" : "Share"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {(log.services_performed as string[])?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {(log.services_performed as string[]).map((s: string) => (
                          <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {log.public_notes && (
                      <p className="text-xs text-muted-foreground italic">"{log.public_notes}"</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Before/After Photo Gallery */}
        <TabsContent value="photos" className="space-y-4">
          {!photos?.length ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">No photos yet.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {[...photosByOrder.entries()].map(([orderId, orderPhotos]) => {
                const beforePhotos = orderPhotos?.filter((p) => p.description?.toLowerCase().includes("before")) ?? [];
                const afterPhotos = orderPhotos?.filter((p) => p.description?.toLowerCase().includes("after")) ?? [];
                const otherPhotos = orderPhotos?.filter((p) =>
                  !p.description?.toLowerCase().includes("before") && !p.description?.toLowerCase().includes("after")
                ) ?? [];

                return (
                  <div key={orderId} className="space-y-3">
                    {orderId !== "unlinked" && (
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                        Service Visit · {orderPhotos?.[0]?.taken_at ? new Date(orderPhotos[0].taken_at).toLocaleDateString() : ""}
                      </p>
                    )}

                    {/* Before/After side by side if both exist */}
                    {beforePhotos.length > 0 && afterPhotos.length > 0 ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          {beforePhotos.map((p) => (
                            <PhotoCard key={p.id} photo={p} label="Before" />
                          ))}
                          {afterPhotos.map((p) => (
                            <PhotoCard key={p.id} photo={p} label="After" />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {(beforePhotos.length > 0 ? beforePhotos : afterPhotos.length > 0 ? afterPhotos : otherPhotos).map((p) => (
                          <PhotoCard key={p.id} photo={p} label={p.description?.toLowerCase().includes("before") ? "Before" : p.description?.toLowerCase().includes("after") ? "After" : undefined} />
                        ))}
                      </div>
                    )}

                    {/* Other photos without before/after label */}
                    {(beforePhotos.length > 0 || afterPhotos.length > 0) && otherPhotos.length > 0 && (
                      <div className="grid grid-cols-2 gap-3">
                        {otherPhotos.map((p) => (
                          <PhotoCard key={p.id} photo={p} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Orders */}
        <TabsContent value="orders" className="space-y-3">
          {!orders?.length ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">No orders for this monument.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <div key={o.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-mono text-muted-foreground">#{o.id.slice(0, 8)}</p>
                      <p className="text-sm">Monument Cleaning · {new Date(o.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[o.status]}`}>
                        {o.status.replace(/_/g, " ")}
                      </span>
                      <p className="font-display font-bold text-sm">${Number(o.total_price).toFixed(2)}</p>
                    </div>
                  </div>
                  {o.scheduled_date && (
                    <p className="text-xs text-muted-foreground">
                      📅 Scheduled for <span className="font-medium text-foreground">{new Date(o.scheduled_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

function PhotoCard({ photo, label }: { photo: any; label?: string }) {
  const handleDownload = async () => {
    try {
      const response = await fetch(photo.photo_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `monument-${label?.toLowerCase() ?? "photo"}-${photo.id.slice(0, 8)}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(photo.photo_url, "_blank");
    }
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card group relative">
      {label && (
        <div className={`absolute top-2 left-2 z-10 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
          label === "Before" ? "bg-accent/90 text-accent-foreground" : "bg-primary/90 text-primary-foreground"
        }`}>
          {label}
        </div>
      )}
      <button
        onClick={handleDownload}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-card/80 rounded-full p-1.5"
        title="Download"
      >
        <Download className="w-3 h-3" />
      </button>
      <img
        src={photo.photo_url}
        alt={photo.description || "Monument photo"}
        className="w-full aspect-square object-cover"
        loading="lazy"
      />
      <div className="p-2 space-y-0.5">
        {photo.description && (
          <p className="text-xs font-medium">{photo.description}</p>
        )}
        <p className="text-[10px] text-muted-foreground">
          {photo.taken_at ? new Date(photo.taken_at).toLocaleDateString() : new Date(photo.created_at).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

export default GraveDetail;
