-- Inventario de insumos agrícolas y registro de aplicaciones por cultivo
create table if not exists public.insumos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  codigo text not null,
  nombre text not null,
  tipo text not null check (tipo in ('agroquimico','fertilizante','semilla','otro')),
  unidad text not null default 'L',
  stock numeric not null default 0,
  creado timestamptz not null default now(),
  unique (user_id, codigo)
);

create table if not exists public.aplicaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  potrero_id uuid references public.ganader_potreros(id) on delete set null,
  cultivo text,
  cantidad numeric not null check (cantidad > 0),
  fecha date not null default current_date,
  nota text,
  creado timestamptz not null default now()
);

alter table public.insumos enable row level security;
alter table public.aplicaciones enable row level security;

drop policy if exists insumos_propios on public.insumos;
create policy insumos_propios on public.insumos for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists aplicaciones_propias on public.aplicaciones;
create policy aplicaciones_propias on public.aplicaciones for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
