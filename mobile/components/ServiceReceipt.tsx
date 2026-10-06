import { Share, Text, View } from 'react-native';

import { styles } from '../styles';
import { useAppContext, type AmountDue, type ServiceQuote } from '../context/AppContext';
import { Card, SecondaryButton } from './ui';
import { acceptedWarranty } from './Quote';
import { formatPesos, parseServerTimestamp } from '../utils';

/**
 * Comprobante de un servicio terminado: quién, qué, cuánto, cómo se pagó, la
 * garantía (con su fecha de vencimiento) y las piezas. Se puede compartir por
 * WhatsApp o donde sea. No es factura fiscal: el cobro es directo entre
 * cliente y mecánico, y así se dice.
 */

type ReceiptRequest = {
  id: number;
  status: string;
  vehicleType?: 'auto' | 'moto';
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number | string;
  issueDescription: string;
  customerName?: string | null;
  mechanicName?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  paidAt?: string | null;
  customerPaidAt?: string | null;
  paymentMethod?: 'cash' | 'transfer' | null;
  amountDue?: AmountDue | null;
  quotes?: ServiceQuote[];
  oldPartsStatus?: 'delivered' | 'declined' | 'none' | null;
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const OLD_PARTS = { delivered: 'entregadas al cliente', declined: 'el cliente no las quiso', none: 'no se cambiaron' } as const;
const METHOD = { cash: 'efectivo', transfer: 'transferencia' } as const;

function shortDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function receiptLines(request: ReceiptRequest): string[] {
  // Servicios de antes de completed_at: la última actualización.
  const finishedMs = parseServerTimestamp(request.completedAt ?? request.updatedAt) ?? Date.now();
  const amounts = request.amountDue;
  const accepted = (request.quotes ?? []).filter((quote) => quote.status === 'accepted');
  const work = accepted.find((quote) => quote.kind !== 'adjustment')?.description;
  const warrantyDays = acceptedWarranty(accepted);
  const lines = [
    `Servicio #${request.id} · ${shortDate(finishedMs)}`,
    `${request.vehicleType === 'moto' ? 'Moto' : 'Auto'}: ${request.vehicleMake} ${request.vehicleModel} ${request.vehicleYear}`,
    request.mechanicName ? `Mecánico: ${request.mechanicName}` : null,
    request.customerName ? `Cliente: ${request.customerName}` : null,
    `Falla reportada: ${request.issueDescription}`,
    work ? `Trabajo: ${work}` : null,
  ];
  if (amounts) {
    if (amounts.cancellationFee) {
      lines.push(`Cargo por cancelación: ${formatPesos(amounts.cancellationFee)}`);
    } else {
      lines.push(`Visita y diagnóstico: ${formatPesos(amounts.visitFee)}`);
      if (amounts.labor > 0) lines.push(`Mano de obra: ${formatPesos(amounts.labor)}`);
      if (amounts.partsOnHand > 0) lines.push(`Refacciones del mecánico: ${formatPesos(amounts.partsOnHand)}`);
      if (amounts.partsBought > 0) lines.push(`Refacciones compradas (con ticket): ${formatPesos(amounts.partsBought)}`);
    }
    lines.push(`Total: ${formatPesos(amounts.total)}`);
  }
  const paid = request.paidAt || request.customerPaidAt;
  lines.push(
    paid
      ? `Pagado${request.paymentMethod ? ` en ${METHOD[request.paymentMethod]}` : ''}, directo al mecánico`
      : 'Pago: directo al mecánico',
  );
  if (warrantyDays != null) {
    lines.push(
      warrantyDays > 0
        ? `Garantía de la mano de obra: ${warrantyDays} días, hasta el ${shortDate(finishedMs + warrantyDays * 86_400_000)}`
        : 'Sin garantía en la mano de obra',
    );
  }
  if (request.oldPartsStatus) lines.push(`Piezas cambiadas: ${OLD_PARTS[request.oldPartsStatus]}`);
  return lines.filter((line): line is string => Boolean(line));
}

export function ServiceReceipt({ request }: { request: ReceiptRequest }) {
  const { setMessage } = useAppContext();
  const payable = request.status === 'completed' || (request.status === 'cancelled' && (request.amountDue?.cancellationFee ?? 0) > 0);
  if (!payable) {
    return null;
  }
  const lines = receiptLines(request);

  function share() {
    const message = [
      'Comprobante de servicio · Mecanifique',
      ...lines,
      'Mecanifique conecta clientes y mecánicos; el cobro es directo entre ellos. Este comprobante no es factura fiscal.',
    ].join('\n');
    Share.share({ message }).catch(() => setMessage('No se pudo compartir el comprobante.'));
  }

  return (
    <Card title="Comprobante" subtitle="Resumen del servicio. No es factura fiscal: el cobro es directo con el mecánico.">
      <View style={styles.stack}>
        {lines.map((line) => (
          <Text key={line} style={styles.itemText}>
            {line}
          </Text>
        ))}
        <SecondaryButton title="Compartir comprobante" onPress={share} />
      </View>
    </Card>
  );
}
