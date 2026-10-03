// This machine on the network: which addresses other PCs can reach it on, and which ports are free.
import net from 'node:net';
import os from 'node:os';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

// Adapters other PCs cannot reach this server through (hypervisor switches, VPN tunnels, Bluetooth …).
const VIRTUAL = /vEthernet|Hyper-V|VirtualBox|VMware|WSL|Docker|Loopback|Bluetooth|Tailscale|ZeroTier|Npcap|TAP-/i;

/** IPv4 addresses on the LAN, the real network cards first. Loopback and self-assigned (169.254.x.x) are left out. */
export function lanAddresses(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const rows: Array<{ address: string; virtual: boolean }> = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      rows.push({ address: a.address, virtual: VIRTUAL.test(name) });
    }
  }
  return [...rows.filter((r) => !r.virtual), ...rows.filter((r) => r.virtual)].map((r) => r.address);
}

/** True when nothing listens on this port (on any address — the services listen on all of them). */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '0.0.0.0', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}
