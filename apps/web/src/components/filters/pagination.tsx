import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";

type PaginationProps = {
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  totalPages: number;
};

export default function Pagination({
  page,
  setPage,
  totalPages,
}: PaginationProps) {
  return (
    <div className="flex items-center justify-between w-full border-t px-4 py-3">
      <div className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={() => setPage(page - 1)}
          disabled={page === 1}
          variant="outline"
          size="sm"
        >
          <ArrowLeft />
          <span className="hidden sm:block">Previous</span>
        </Button>
        <Button
          onClick={() => setPage(page + 1)}
          disabled={page === totalPages}
          variant="outline"
          size="sm"
        >
          <span className="hidden sm:block">Next</span>
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
