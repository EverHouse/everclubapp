import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWithCredentials } from '../../../hooks/queries/useFetch';
import { AnimatedPage } from '../../../components/motion';
import WalkingGolferSpinner from '../../../components/WalkingGolferSpinner';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface PeakHourEntry {
  day_of_week: number;
  hour_of_day: number;
  booking_count: number;
}

interface ResourceEntry {
  resourceName: string;
  totalHours: number;
}

interface TopMember {
  memberName: string;
  memberEmail: string;
  totalHours: number;
}

interface BookingStats {
  peakHours: PeakHourEntry[];
  resourceUtilization: ResourceEntry[];
  topMembers: TopMember[];
  cancellationRate: number;
  totalBookings: number;
  cancelledBookings: number;
  avgSessionMinutes: number;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return '12a';
  if (i < 12) return `${i}a`;
  if (i === 12) return '12p';
  return `${i - 12}p`;
});

const RESOURCE_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#818cf8'];

function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function getHeatmapClasses(value: number, max: number): string {
  if (value === 0 || max === 0) return 'bg-primary/5 dark:bg-white/5';
  const intensity = value / max;
  if (intensity < 0.25) return 'bg-indigo-200 dark:bg-indigo-900';
  if (intensity < 0.5) return 'bg-indigo-300 dark:bg-indigo-700';
  if (intensity < 0.75) return 'bg-indigo-400 dark:bg-indigo-500';
  return 'bg-indigo-500 dark:bg-indigo-400';
}

const LEGEND_CLASSES = [
  'bg-primary/5 dark:bg-white/5',
  'bg-indigo-200 dark:bg-indigo-900',
  'bg-indigo-300 dark:bg-indigo-700',
  'bg-indigo-400 dark:bg-indigo-500',
  'bg-indigo-500 dark:bg-indigo-400',
];

const PeakHoursHeatmap: React.FC<{ data: PeakHourEntry[] }> = ({ data }) => {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxCount = 0;

  for (const entry of data) {
    const day = Number(entry.day_of_week);
    const hour = Number(entry.hour_of_day);
    const count = Number(entry.booking_count);
    if (day >= 0 && day < 7 && hour >= 0 && hour < 24) {
      grid[day][hour] = count;
      if (count > maxCount) maxCount = count;
    }
  }

  const startHour = 6;
  const endHour = 23;

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full border-collapse text-xs" style={{ minWidth: '480px' }}>
        <thead>
          <tr>
            <th className="p-1 text-left text-primary/50 dark:text-white/50 font-normal w-10" />
            {HOUR_LABELS.slice(startHour, endHour + 1).map((label) => (
              <th key={label} className="p-0.5 text-center text-primary/50 dark:text-white/50 font-normal">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAY_LABELS.map((day, dayIdx) => (
            <tr key={day}>
              <td className="p-1 text-primary/70 dark:text-white/70 font-medium text-xs">{day}</td>
              {Array.from({ length: endHour - startHour + 1 }, (_, i) => {
                const hour = startHour + i;
                const count = grid[dayIdx][hour];
                return (
                  <td key={hour} className="p-0.5">
                    <div
                      className={`rounded-sm aspect-square flex items-center justify-center text-[10px] transition-colors ${getHeatmapClasses(count, maxCount)} ${count > 0 ? 'text-white font-medium' : ''}`}
                      style={{ minWidth: '22px', minHeight: '22px' }}
                      title={`${day} ${HOUR_LABELS[hour]}: ${count} booking${count !== 1 ? 's' : ''}`}
                    >
                      {count > 0 ? count : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-1.5 mt-3 text-xs text-primary/50 dark:text-white/50">
        <span>Less</span>
        {LEGEND_CLASSES.map((cls, i) => (
          <div key={i} className={`w-3.5 h-3.5 rounded-sm ${cls}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
};

const ResourceUtilizationChart: React.FC<{ data: ResourceEntry[] }> = ({ data }) => {
  if (data.length === 0) {
    return <p className="text-primary/50 dark:text-white/50 text-sm">No resource data available.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: 'currentColor', fillOpacity: 0.5, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          unit="h"
        />
        <YAxis
          dataKey="resourceName"
          type="category"
          tick={{ fill: 'currentColor', fillOpacity: 0.7, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={110}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-bone, #f5f0e8)',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: '8px',
            color: '#1a1a1a',
          }}
          formatter={(value: number) => [`${value} hours`, 'Total Booked']}
        />
        <Bar dataKey="totalHours" radius={[0, 6, 6, 0]} maxBarSize={28}>
          {data.map((_, index) => (
            <Cell key={index} fill={RESOURCE_COLORS[index % RESOURCE_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const TopMembersLeaderboard: React.FC<{ data: TopMember[] }> = ({ data }) => {
  if (data.length === 0) {
    return <p className="text-primary/50 dark:text-white/50 text-sm">No member data available.</p>;
  }

  const maxHours = Math.max(...data.map((m) => m.totalHours), 1);

  return (
    <div className="space-y-3">
      {data.map((member, idx) => (
        <div key={member.memberEmail} className="flex items-center gap-3">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{
              backgroundColor: idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7f32' : 'rgba(128,128,128,0.15)',
              color: idx < 3 ? '#000' : 'inherit',
            }}
          >
            {idx + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-primary/90 dark:text-white/90 font-medium truncate">{member.memberName}</div>
            <div className="relative h-2 mt-1 rounded-full overflow-hidden bg-primary/5 dark:bg-white/10">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all"
                style={{
                  width: `${(member.totalHours / maxHours) * 100}%`,
                  backgroundColor: RESOURCE_COLORS[idx % RESOURCE_COLORS.length],
                }}
              />
            </div>
          </div>
          <div className="flex-shrink-0 text-sm text-primary/60 dark:text-white/60 font-mono tabular-nums">{member.totalHours}h</div>
        </div>
      ))}
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string;
  subtitle?: string;
  icon: string;
  accentColor?: string;
}> = ({ label, value, subtitle, icon, accentColor = '#6366f1' }) => (
  <div className="glass-card rounded-xl p-4 flex items-start gap-3 border border-primary/10 dark:border-white/10">
    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${accentColor}20` }}>
      <span className="material-symbols-outlined text-xl" style={{ color: accentColor }}>{icon}</span>
    </div>
    <div className="min-w-0">
      <div className="text-[11px] text-primary/50 dark:text-white/50 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-2xl font-semibold text-primary dark:text-white" style={{ fontFamily: 'var(--font-heading)' }}>{value}</div>
      {subtitle && <div className="text-xs text-primary/40 dark:text-white/40 mt-0.5">{subtitle}</div>}
    </div>
  </div>
);

const AnalyticsTab: React.FC = () => {
  const { data, isLoading, error } = useQuery<BookingStats>({
    queryKey: ['booking-analytics'],
    queryFn: () => fetchWithCredentials<BookingStats>('/api/analytics/booking-stats'),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <WalkingGolferSpinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-primary/50 dark:text-white/50">
        <div className="text-center">
          <span className="material-symbols-outlined text-4xl mb-2 block">error_outline</span>
          <p>Failed to load analytics data.</p>
        </div>
      </div>
    );
  }

  return (
    <AnimatedPage>
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-primary dark:text-white" style={{ fontFamily: 'var(--font-heading)' }}>Booking Analytics</h1>
          <p className="text-sm text-primary/50 dark:text-white/50 mt-1">Insights from your booking history</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <StatCard
            label="Total Bookings"
            value={data.totalBookings.toLocaleString()}
            icon="calendar_today"
            accentColor="#6366f1"
          />
          <StatCard
            label="Cancellation Rate"
            value={`${data.cancellationRate}%`}
            subtitle={`${data.cancelledBookings} of ${data.totalBookings} cancelled`}
            icon="event_busy"
            accentColor={data.cancellationRate > 20 ? '#ef4444' : data.cancellationRate > 10 ? '#f59e0b' : '#22c55e'}
          />
          <StatCard
            label="Avg Session Length"
            value={formatDuration(data.avgSessionMinutes)}
            subtitle={`${data.avgSessionMinutes} minutes`}
            icon="timer"
            accentColor="#8b5cf6"
          />
        </div>

        <div className="glass-card rounded-xl p-4 sm:p-5 border border-primary/10 dark:border-white/10">
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
            <span className="material-symbols-outlined text-lg text-primary/60 dark:text-white/60">local_fire_department</span>
            <h2 className="text-base sm:text-lg font-semibold text-primary dark:text-white" style={{ fontFamily: 'var(--font-heading)' }}>Weekly Peak Hours</h2>
          </div>
          <PeakHoursHeatmap data={data.peakHours} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div className="glass-card rounded-xl p-4 sm:p-5 border border-primary/10 dark:border-white/10">
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
              <span className="material-symbols-outlined text-lg text-primary/60 dark:text-white/60">sports_golf</span>
              <h2 className="text-base sm:text-lg font-semibold text-primary dark:text-white" style={{ fontFamily: 'var(--font-heading)' }}>Resource Utilization</h2>
            </div>
            <ResourceUtilizationChart data={data.resourceUtilization} />
          </div>

          <div className="glass-card rounded-xl p-4 sm:p-5 border border-primary/10 dark:border-white/10">
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
              <span className="material-symbols-outlined text-lg text-primary/60 dark:text-white/60">emoji_events</span>
              <h2 className="text-base sm:text-lg font-semibold text-primary dark:text-white" style={{ fontFamily: 'var(--font-heading)' }}>Top Members</h2>
            </div>
            <p className="text-xs text-primary/40 dark:text-white/40 mb-3">By total hours booked</p>
            <TopMembersLeaderboard data={data.topMembers} />
          </div>
        </div>
      </div>
    </AnimatedPage>
  );
};

export default AnalyticsTab;
