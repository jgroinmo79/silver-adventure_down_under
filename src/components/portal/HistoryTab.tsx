import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Camera, ClipboardList, Wrench, MessageSquare, Download } from "lucide-react";

const BUNDLE_LABELS: Record<string, string> = {
  flower_1: "1 Flower Placement",
  flower_2: "2 Flower Placements",
  flower_3: "3 Flower Placements",
  flower_4: "4 Flower Placements",
};

const PLAN_LABELS: Record<string, string> = {
  keeper: "2 Cleanings / Year",
  sentinel: "3 Cleanings / Year",
  legacy: "4 Cleanings / Year",
};

const ADD_ON_LABELS: Record<string, string> = {
  damage_report: "Damage Documentation Report",
  inscription_repainting: "Inscription Repainting",
  weeding: "Weeding & Plot Edging",
  flag_placement: "Flag Placement",
  bronze_cleaning: "Bronze Marker Specialized Cleaning",
  crack_repair: "Stone Crack / Chip Repair",
  video_documentation: "Video Documentation",
};

interface HistoryTabProps {
  orders: any[];
}

const HistoryTab = ({ orders }: HistoryTabProps) => {
  const { user } = useAuth();

  // Fetch all service logs for this user
  const { data: serviceLogs } = useQuery({
    queryKey: ["portal-service-logs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_logs")
        .select("*")
        .eq("user_id", user?.id ?? "")
        .order("service_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch all client-visible photos for this user
  const { data: photos } = useQuery({
    queryKey: ["portal-history-photos", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photo_records")
        .select("*")
        .eq("user_id", user?.id ?? "")
        .eq("client_visible", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const statusColors: Record<string, string> = {
    pending: "bg-accent/20 text-accent",
    confirmed: "bg-primary/20 text-primary",
    scheduled: "bg-primary/20 text-primary",
    in_progress: "bg-accent/20 text-accent",
    completed: "bg-primary/20 text-primary",
    cancelled: "bg-destructive/20 text-destructive",
  };

  const statusLabels: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    scheduled: "Scheduled",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  if (!orders?.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground text-sm">No orders yet.</p>
      </div>
    );
  }

  // Build "services requested" from order data
  const getServicesRequested = (order: any): string[] => {
    const items: string[] = [];

    // Main service
    if (order.bundle_id && BUNDLE_LABELS[order.bundle_id]) {
      items.push(BUNDLE_LABELS[order.bundle_id]);
    } else {
      items.push("Monument Cleaning");
    }

    // Add-ons
    if (order.add_ons && Array.isArray(order.add_ons)) {
      order.add_ons.forEach((addon: any) => {
        const label = typeof addon === "string"
          ? (ADD_ON_LABELS[addon] || addon)
          : (ADD_ON_LABELS[addon?.id] || addon?.label || addon?.id || "Add-on");
        items.push(label);
      });
    }

    return items;
  };

  // Get service logs linked to an order
  const getOrderLogs = (orderId: string) => {
    return serviceLogs?.filter((l) => l.order_id === orderId) ?? [];
  };

  // Get technician photos for an order (exclude customer intake photos by checking description)
  const getOrderPhotos = (orderId: string) => {
    return photos?.filter((p) => p.order_id === orderId) ?? [];
  };

  return (
    <div className="grid gap-4">
      {orders.map((o) => {
        const servicesRequested = getServicesRequested(o);
        const logs = getOrderLogs(o.id);
        const orderPhotos = getOrderPhotos(o.id);

        return (
          <div key={o.id} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Order header */}
            <div className="p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-mono text-muted-foreground">#{o.id.slice(0, 8)}</p>
                  <p className="text-sm font-semibold">
                    {o.bundle_id && BUNDLE_LABELS[o.bundle_id]
                      ? BUNDLE_LABELS[o.bundle_id]
                      : "Monument Cleaning"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ordered {new Date(o.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[o.status] ?? ""}`}>
                    {statusLabels[o.status] ?? o.status}
                  </span>
                  <p className="font-display font-bold">${Number(o.total_price).toFixed(2)}</p>
                </div>
              </div>
              {o.scheduled_date && (
                <p className="text-xs text-muted-foreground">
                  📅 Scheduled for{" "}
                  <span className="font-medium text-foreground">
                    {new Date(o.scheduled_date + "T00:00:00").toLocaleDateString("en-US", {
                      weekday: "short", month: "short", day: "numeric", year: "numeric",
                    })}
                  </span>
                </p>
              )}
            </div>

            {/* Services Requested */}
            {servicesRequested.length > 0 && (
              <div className="border-t border-border px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xs font-semibold text-foreground">Services Requested</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {servicesRequested.map((s, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Technician sections — show per service log */}
            {logs.length > 0 && logs.map((log) => (
              <div key={log.id} className="border-t border-border">
                {/* Technician Performed */}
                {(log.services_performed as string[])?.length > 0 && (
                  <div className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-primary" />
                      <p className="text-xs font-semibold text-foreground">Technician Performed</p>
                      {log.time_spent_minutes && (
                        <span className="text-[10px] text-muted-foreground ml-auto">{log.time_spent_minutes} min</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(log.services_performed as string[]).map((s: string) => (
                        <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Technician Notes */}
                {log.public_notes && (
                  <div className="px-4 py-3 border-t border-border/50 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      <p className="text-xs font-semibold text-foreground">Technician Notes</p>
                    </div>
                    <p className="text-xs text-muted-foreground italic leading-relaxed">"{log.public_notes}"</p>
                  </div>
                )}
              </div>
            ))}

            {/* Photos */}
            {orderPhotos.length > 0 && (
              <div className="border-t border-border px-4 py-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xs font-semibold text-foreground">Photos</p>
                  <span className="text-[10px] text-muted-foreground ml-auto">{orderPhotos.length} photo{orderPhotos.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {orderPhotos.map((p) => (
                    <HistoryPhoto key={p.id} photo={p} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

function HistoryPhoto({ photo }: { photo: any }) {
  const handleDownload = async () => {
    try {
      const response = await fetch(photo.photo_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `photo-${photo.id.slice(0, 8)}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(photo.photo_url, "_blank");
    }
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-card group relative">
      <button
        onClick={handleDownload}
        className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-card/80 rounded-full p-1"
        title="Download"
      >
        <Download className="w-3 h-3" />
      </button>
      <img
        src={photo.photo_url}
        alt={photo.description || "Service photo"}
        className="w-full aspect-square object-cover"
        loading="lazy"
      />
      {photo.description && (
        <p className="text-[10px] text-muted-foreground px-1.5 py-1 truncate">{photo.description}</p>
      )}
    </div>
  );
}

export default HistoryTab;
