import InquiryForm from "./form";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <InquiryForm id={(await params).id} />;
}
